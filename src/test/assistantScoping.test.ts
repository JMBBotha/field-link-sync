import { describe, expect, it } from "vitest";
import {
  logAssistantAudit,
  resolvePersona,
  resolveScope,
  sanitizeArgs,
} from "../../supabase/functions/_shared/assistantScope";

/**
 * Authorization matrix for the read-only assistant tool slice.
 *
 * Personas: admin/ops, technician, sales/estimator, client-portal user.
 * Every case proves that scope is derived from the caller identity only, and
 * that swapping ids in the payload cannot reach another technician's data or
 * another organisation's data.
 */

const ORG_A = "org-a";
const ORG_B = "org-b";

const ADMIN = "user-admin";
const TECH_A = "user-tech-a";
const TECH_B = "user-tech-b";
const SALES = "user-sales";
const CLIENT = "user-client";

const FIXTURE: Record<string, any[]> = {
  customers: [
    { id: "cust-1", company_id: ORG_A, email: "client@a.test", normalized_email: "client@a.test" },
    { id: "cust-2", company_id: ORG_A, email: "other@a.test", normalized_email: "other@a.test" },
    { id: "cust-x", company_id: ORG_B, email: "client@a.test", normalized_email: "client@a.test" },
  ],
  jobs: [
    { id: "job-1", company_id: ORG_A, customer_id: "cust-1", created_by: ADMIN },
    { id: "job-2", company_id: ORG_A, customer_id: "cust-2", created_by: ADMIN },
    { id: "job-x", company_id: ORG_B, customer_id: "cust-x", created_by: ADMIN },
  ],
  assignments: [
    { job_id: "job-1", profile_id: TECH_A },
    { job_id: "job-2", profile_id: TECH_B },
    // TECH_A "assigned" to a job in another organisation — must be dropped.
    { job_id: "job-x", profile_id: TECH_A },
  ],
  leads: [{ id: "lead-1", company_id: ORG_A, sales_engineer_id: SALES, customer_id: "cust-1" }],
  quotes: [{ id: "q-1", company_id: ORG_A, sales_engineer_id: SALES, customer_id: "cust-1" }],
  assistant_audit_logs: [],
};

function mockDb(fixture = FIXTURE) {
  const builder = (table: string) => {
    let out = [...(fixture[table] ?? [])];
    const api: any = {
      select: () => api,
      eq: (c: string, v: unknown) => {
        out = out.filter((r) => r[c] === v);
        return api;
      },
      in: (c: string, vals: unknown[]) => {
        out = out.filter((r) => vals.includes(r[c]));
        return api;
      },
      or: (expr: string) => {
        // Split on the first two dots only — values (e.g. emails) contain dots.
        const clauses = expr.split(",").map((c) => {
          const [col, op, ...rest] = c.split(".");
          return [col, op, rest.join(".")] as const;
        });
        out = out.filter((r) =>
          clauses.some(([col, op, val]) =>
            op === "is" ? (val === "null" ? r[col] == null : String(r[col]) === val) : String(r[col]) === val
          )
        );
        return api;
      },
      is: (c: string, v: unknown) => {
        out = out.filter((r) => (v === null ? r[c] == null : r[c] === v));
        return api;
      },
      not: () => api,
      gte: () => api,
      lte: () => api,
      ilike: () => api,
      order: () => api,
      range: (from: number, to: number) => {
        out = out.slice(from, to + 1);
        return api;
      },
      limit: (n: number) => {
        out = out.slice(0, n);
        return api;
      },
      insert: (row: any) => {
        (fixture[table] ??= []).push(row);
        return Promise.resolve({ data: null, error: null });
      },
      then: (resolve: (v: any) => void) => resolve({ data: out, error: null }),
    };
    return api;
  };
  return { from: (t: string) => builder(t) } as any;
}

const ids = (s: Set<string> | null) => (s ? [...s].sort() : null);

describe("assistant persona resolution", () => {
  it("picks the most privileged role and never defaults to ops", () => {
    expect(resolvePersona(["admin"])).toBe("ops");
    expect(resolvePersona(["dispatcher", "field_agent"])).toBe("ops");
    expect(resolvePersona(["sales"])).toBe("sales");
    expect(resolvePersona(["field_agent"])).toBe("technician");
    expect(resolvePersona(["client"])).toBe("client");
    expect(resolvePersona([])).toBe("technician");
    expect(resolvePersona(["viewer"])).toBe("technician");
  });
});

describe("assistant scope matrix", () => {
  it("admin/ops sees the whole organisation (null = unrestricted within company)", async () => {
    const s = await resolveScope(mockDb(), ADMIN, ORG_A, ["admin"]);
    expect(s.persona).toBe("ops");
    expect(s.customerIds).toBeNull();
    expect(s.jobIds).toBeNull();
    expect(s.canSeeInventory).toBe(true);
  });

  it("technician sees only their assigned jobs and those jobs' customers", async () => {
    const s = await resolveScope(mockDb(), TECH_A, ORG_A, ["field_agent"]);
    expect(ids(s.jobIds)).toEqual(["job-1"]);
    expect(ids(s.customerIds)).toEqual(["cust-1"]);
  });

  it("a technician cannot reach another technician's job or customer", async () => {
    const a = await resolveScope(mockDb(), TECH_A, ORG_A, ["field_agent"]);
    const b = await resolveScope(mockDb(), TECH_B, ORG_A, ["field_agent"]);
    expect(a.jobIds!.has("job-2")).toBe(false);
    expect(a.customerIds!.has("cust-2")).toBe(false);
    expect(b.jobIds!.has("job-1")).toBe(false);
    expect(b.customerIds!.has("cust-1")).toBe(false);
  });

  it("cross-organisation assignments are stripped even when the id is known", async () => {
    const s = await resolveScope(mockDb(), TECH_A, ORG_A, ["field_agent"]);
    expect(s.jobIds!.has("job-x")).toBe(false);
    expect(s.customerIds!.has("cust-x")).toBe(false);
  });

  it("client-portal user only resolves to their own customer record, in their own org", async () => {
    const s = await resolveScope(mockDb(), CLIENT, ORG_A, ["client"], "Client@A.test");
    expect(ids(s.customerIds)).toEqual(["cust-1"]);
    expect(s.customerIds!.has("cust-x")).toBe(false);
    expect(s.canSeeInventory).toBe(false);
  });

  it("client with no matching email gets an empty scope, never a wildcard", async () => {
    const s = await resolveScope(mockDb(), CLIENT, ORG_A, ["client"], "nobody@a.test");
    expect(ids(s.customerIds)).toEqual([]);
    expect(ids(s.jobIds)).toEqual([]);
  });

  it("sales/estimator is restricted to owned records, not the whole org", async () => {
    const s = await resolveScope(mockDb(), SALES, ORG_A, ["sales"]);
    expect(s.persona).toBe("sales");
    expect(s.customerIds).not.toBeNull();
    expect(s.jobIds).not.toBeNull();
    expect(s.canSeeInventory).toBe(true);
  });

  it("a caller with no organisation gets nothing", async () => {
    const s = await resolveScope(mockDb(), ADMIN, null, ["admin"]);
    expect(ids(s.customerIds)).toEqual([]);
    expect(ids(s.jobIds)).toEqual([]);
    expect(s.canSeeInventory).toBe(false);
  });
});

describe("assistant audit logging", () => {
  it("redacts secrets and truncates free text before logging", () => {
    const out = sanitizeArgs({
      query: "x".repeat(400),
      api_key: "sk-live-123",
      card_number: "4111111111111111",
      limit: 10,
      nested: { a: 1 },
    });
    expect((out.query as string).length).toBe(120);
    expect(out.api_key).toBe("[redacted]");
    expect(out.card_number).toBe("[redacted]");
    expect(out.limit).toBe(10);
    expect(out.nested).toBe("[object]");
  });

  it("writes an audit row for both allowed and denied tool calls", async () => {
    const fixture = { ...FIXTURE, assistant_audit_logs: [] as any[] };
    const db = mockDb(fixture);
    await logAssistantAudit(db, {
      userId: TECH_A,
      companyId: ORG_A,
      role: "technician",
      toolName: "get_assigned_jobs",
      args: { limit: 5 },
      resultCount: 1,
      outcome: "success",
      channel: "voice",
      sessionId: "sess-1",
    });
    await logAssistantAudit(db, {
      userId: TECH_A,
      companyId: ORG_A,
      role: "technician",
      toolName: "get_customer_details",
      args: { customer_id: "cust-2" },
      resultCount: 0,
      outcome: "access_denied",
      errorCode: "not_found",
      channel: "text",
    });
    const rows = fixture.assistant_audit_logs;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      user_id: TECH_A,
      company_id: ORG_A,
      resolved_role: "technician",
      tool_name: "get_assigned_jobs",
      outcome: "success",
      channel: "voice",
      session_id: "sess-1",
      result_count: 1,
    });
    expect(rows[1]).toMatchObject({ outcome: "access_denied", tool_name: "get_customer_details" });
    // No tokens/PII beyond the identifiers we intentionally record.
    expect(JSON.stringify(rows)).not.toMatch(/token|secret|password/i);
  });
});
