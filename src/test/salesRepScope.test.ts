import { describe, expect, it } from "vitest";
import { loadCallerRoles } from "../../supabase/functions/_shared/assistantScope";
import { getOwnedScope } from "../../supabase/functions/_shared/ownership";
import { hasRecordAccess } from "../../supabase/functions/_shared/recordAccess";

const ORG = "org-a";
const REP = "rep-1";
const ADMIN = "admin-1";
const OFFICE = "office-1";
const OTHER = "rep-2";

function mockDb(fixture: Record<string, any[]>, rpc?: (fn: string, args: any) => any) {
  const builder = (table: string) => {
    let out = [...(fixture[table] ?? [])];
    const api: any = {
      select: () => api,
      eq: (c: string, v: unknown) => ((out = out.filter((r) => r[c] === v)), api),
      in: (c: string, vals: unknown[]) => ((out = out.filter((r) => vals.includes(r[c]))), api),
      or: (expr: string) => {
        const clauses = expr.split(",").map((c) => {
          const [col, , ...rest] = c.split(".");
          return [col, rest.join(".")] as const;
        });
        out = out.filter((r) => clauses.some(([col, val]) => String(r[col]) === val));
        return api;
      },
      is: (c: string, v: unknown) => ((out = out.filter((r) => (v === null ? r[c] == null : r[c] === v))), api),
      limit: (n: number) => ((out = out.slice(0, n)), api),
      then: (resolve: (v: any) => void) => resolve({ data: out, error: null }),
    };
    return api;
  };
  const db: any = { from: (t: string) => builder(t) };
  if (rpc) db.rpc = async (fn: string, args: any) => rpc(fn, args);
  return db;
}

const BASE = {
  user_roles: [
    { user_id: REP, role: "dispatcher" },
    { user_id: ADMIN, role: "admin" },
    { user_id: ADMIN, role: "dispatcher" },
    { user_id: OFFICE, role: "dispatcher" },
  ],
  profiles: [
    { id: REP, dispatch_role: "sales" },
    { id: ADMIN, dispatch_role: "sales" },
    { id: OFFICE, dispatch_role: "dispatch" },
  ],
};

describe("loadCallerRoles", () => {
  it("rep -> ['sales'] via rpc", async () => {
    const db = mockDb(BASE, (fn, a) => ({ data: fn === "is_sales_rep" && a._uid === REP, error: null }));
    expect(await loadCallerRoles(db, REP)).toEqual(["sales"]);
  });
  it("admin+dispatcher unchanged", async () => {
    const db = mockDb(BASE, () => ({ data: false, error: null }));
    expect(await loadCallerRoles(db, ADMIN)).toEqual(["admin", "dispatcher"]);
  });
  it("office dispatcher unchanged", async () => {
    expect(await loadCallerRoles(mockDb(BASE), OFFICE)).toEqual(["dispatcher"]);
  });
  it("rpc missing -> code fallback", async () => {
    expect(await loadCallerRoles(mockDb(BASE), REP)).toEqual(["sales"]);
    expect(await loadCallerRoles(mockDb(BASE), ADMIN)).toEqual(["admin", "dispatcher"]);
  });
  it("rpc error -> code fallback", async () => {
    const db = mockDb(BASE, () => ({ data: null, error: { message: "nope" } }));
    expect(await loadCallerRoles(db, REP)).toEqual(["sales"]);
  });
});

describe("getOwnedScope for reps", () => {
  const fixture = {
    leads: [{ id: "l1", customer_id: "c-lead", company_id: ORG, created_by: REP, deleted_at: null }],
    quotes: [
      { id: "q1", customer_id: "c-owner", company_id: ORG, owner_id: REP, lead_id: null },
      { id: "q2", customer_id: "c-other", company_id: ORG, owner_id: OTHER, lead_id: null },
    ],
  };
  it("includes rep_customer_ids (plain and object rows) and owner/creator matches", async () => {
    const db = mockDb(fixture, (fn) =>
      fn === "rep_customer_ids" ? { data: ["c-ded1", { rep_customer_ids: "c-ded2" }], error: null } : { data: null, error: null }
    );
    const s = await getOwnedScope(db, REP, ORG);
    expect([...s.customerIds].sort()).toEqual(["c-ded1", "c-ded2", "c-lead", "c-owner"]);
    expect(s.quoteIds.has("q1")).toBe(true);
    expect(s.quoteIds.has("q2")).toBe(false);
    expect(s.leadIds.has("l1")).toBe(true);
  });
  it("ignores an rpc error", async () => {
    const db = mockDb(fixture, () => ({ data: null, error: { message: "x" } }));
    const s = await getOwnedScope(db, REP, ORG);
    expect([...s.customerIds].sort()).toEqual(["c-lead", "c-owner"]);
  });
});

describe("hasRecordAccess for reps", () => {
  const db = mockDb({ ...BASE, jobs: [], assignments: [], offers: [] });
  it("denies a quote owned by someone else", async () => {
    expect(await hasRecordAccess(db, REP, "quote", { id: "q2", owner_id: OTHER, sales_engineer_id: OTHER })).toBe(false);
  });
  it("allows a quote with owner_id = rep", async () => {
    expect(await hasRecordAccess(db, REP, "quote", { id: "q1", owner_id: REP })).toBe(true);
  });
  it("office dispatcher keeps ops access", async () => {
    expect(await hasRecordAccess(db, OFFICE, "quote", { id: "q2", owner_id: OTHER })).toBe(true);
  });
});
