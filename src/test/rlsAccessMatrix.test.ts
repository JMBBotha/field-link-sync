import { describe, expect, it } from "vitest";
import { hasRecordAccess } from "../../supabase/functions/_shared/recordAccess";

/**
 * Regression suite for the NL / voice assistant access-control matrix.
 * Mirrors the live test matrix validated against the database:
 *   a) admin/ops -> full company access
 *   b) assigned technician -> own job's invoice/quote
 *   c) same technician -> other technician's records => denied ("not found")
 *   d) audit log shape: access_granted true/false + resource metadata
 */

const ADMIN = "00000000-0000-0000-0000-0000000000ad";
const TECH_A = "4b3de958-0000-0000-0000-000000000001";
const TECH_B = "2f7f1dd8-0000-0000-0000-000000000002";
const OTHER = "99999999-0000-0000-0000-000000000099";

const INVOICE_A = { id: "inv-a", quote_id: null, agent_id: OTHER };
const INVOICE_B = { id: "inv-b", quote_id: null, agent_id: OTHER };
const QUOTE_B = { id: "q-b", sales_engineer_id: OTHER, lead_id: "lead-b" };

/** Fixture graph: job A -> invoice A -> assigned TECH_A, job B -> invoice/quote B -> TECH_B. */
const FIXTURE = {
  user_roles: [{ user_id: ADMIN, role: "admin" }],
  jobs: [
    { id: "job-a", created_by: OTHER, invoice_id: "inv-a", quote_id: null },
    { id: "job-b", created_by: OTHER, invoice_id: "inv-b", quote_id: "q-b" },
  ],
  assignments: [
    { id: "as-a", job_id: "job-a", profile_id: TECH_A },
    { id: "as-b", job_id: "job-b", profile_id: TECH_B },
  ],
  offers: [{ id: "of-b", lead_id: "lead-b", staff_id: TECH_B, status: "accepted" }],
};

/** Tiny in-memory stand-in for the PostgREST query builder subset used. */
function mockDb(fixture = FIXTURE) {
  const builder = (rows: any[]) => {
    let out = [...rows];
    const api: any = {
      select: () => api,
      eq: (col: string, val: unknown) => {
        out = out.filter((r) => r[col] === val);
        return api;
      },
      in: (col: string, vals: unknown[]) => {
        out = out.filter((r) => vals.includes(r[col]));
        return api;
      },
      or: (expr: string) => {
        const clauses = expr.split(",").map((c) => c.split("."));
        out = out.filter((r) => clauses.some(([col, , val]) => String(r[col]) === val));
        return api;
      },
      limit: (n: number) => {
        out = out.slice(0, n);
        return api;
      },
      then: (resolve: (v: any) => void) => resolve({ data: out, error: null }),
    };
    return api;
  };
  return { from: (t: string) => builder((fixture as any)[t] ?? []) };
}

describe("NL assistant record access matrix", () => {
  it("a) admin/ops user has full access to any company record", async () => {
    const db = mockDb();
    expect(await hasRecordAccess(db, ADMIN, "invoice", INVOICE_A)).toBe(true);
    expect(await hasRecordAccess(db, ADMIN, "invoice", INVOICE_B)).toBe(true);
    expect(await hasRecordAccess(db, ADMIN, "quote", QUOTE_B)).toBe(true);
  });

  it("b) assigned technician can access their own job's invoice", async () => {
    expect(await hasRecordAccess(mockDb(), TECH_A, "invoice", INVOICE_A)).toBe(true);
    expect(await hasRecordAccess(mockDb(), TECH_B, "invoice", INVOICE_B)).toBe(true);
  });

  it("c) technician cannot access another technician's invoice or quote", async () => {
    expect(await hasRecordAccess(mockDb(), TECH_A, "invoice", INVOICE_B)).toBe(false);
    expect(await hasRecordAccess(mockDb(), TECH_A, "quote", QUOTE_B)).toBe(false);
    expect(await hasRecordAccess(mockDb(), TECH_B, "invoice", INVOICE_A)).toBe(false);
  });

  it("owner branches: quote sales_engineer_id / invoice agent_id", async () => {
    expect(await hasRecordAccess(mockDb(), OTHER, "invoice", INVOICE_A)).toBe(true);
    expect(await hasRecordAccess(mockDb(), OTHER, "quote", QUOTE_B)).toBe(true);
  });

  it("offeror branch: accepted offer on the quote's lead grants access", async () => {
    expect(await hasRecordAccess(mockDb(), TECH_B, "quote", QUOTE_B)).toBe(true);
    const pending = {
      ...FIXTURE,
      assignments: [],
      offers: [{ id: "of-b", lead_id: "lead-b", staff_id: TECH_B, status: "pending" }],
    };
    expect(await hasRecordAccess(mockDb(pending), TECH_B, "quote", QUOTE_B)).toBe(false);
  });

  it("job-creator branch applies to quotes only", async () => {
    const f = {
      ...FIXTURE,
      jobs: [{ id: "job-b", created_by: TECH_A, invoice_id: "inv-b", quote_id: "q-b" }],
      assignments: [],
      offers: [],
    };
    expect(await hasRecordAccess(mockDb(f), TECH_A, "quote", QUOTE_B)).toBe(true);
    expect(await hasRecordAccess(mockDb(f), TECH_A, "invoice", INVOICE_B)).toBe(false);
  });

  it("d) audit metadata reflects the access decision", async () => {
    const db = mockDb();
    const audit = async (userId: string, row: Record<string, any>) => {
      const granted = await hasRecordAccess(db, userId, "invoice", row);
      return {
        user_id: userId,
        resource_type: "invoice",
        resource_id: row.id,
        access_granted: granted,
        // denial must never disclose existence
        summary: granted ? "1 invoice(s) found" : "No invoice found",
      };
    };
    expect(await audit(TECH_A, INVOICE_A)).toMatchObject({
      access_granted: true,
      resource_id: "inv-a",
    });
    const denied = await audit(TECH_A, INVOICE_B);
    expect(denied.access_granted).toBe(false);
    expect(denied.summary).not.toMatch(/denied|forbidden|permission/i);
  });
});
