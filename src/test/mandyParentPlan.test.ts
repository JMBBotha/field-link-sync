import { describe, it, expect, vi } from "vitest";
import { toolAllowed, filterTools, routedCallAllowed, mandyPlanOff, PARENT_TOOLS } from "../../supabase/functions/_shared/mandyPolicy";
import { makeParentHandlers, parentSummary, WORK_ACTION_SCHEMAS } from "@/lib/mandy/workActions";
import { planMonthlyZar, contractTerms } from "@/lib/companyPlan";

const t = (name: string) => ({ type: "function", function: { name } });
const fmt = (n: number) => `R${n}`;
const row = (o: Record<string, unknown>) => ({ company_id: "x", company: "X", leads_today: 0, leads_30d: 0, quotes_waiting: 0, quotes_waiting_value: 0, invoices_open: 0, outstanding: 0, overdue_count: 0, overdue_value: 0, paid_this_month: 0, jobs_today: 0, jobs_open: 0, followups_pending: 0, users: 1, ...o }) as any;

describe("top-level Mandy (phase 5)", () => {
  it("parent tools only for a server-verified parent admin", () => {
    for (const n of PARENT_TOOLS) {
      expect(toolAllowed("admin", n)).toBe(false);
      expect(toolAllowed("admin", n, true)).toBe(true);
      expect(toolAllowed("office", n, true)).toBe(false);
      expect(toolAllowed("sales", n, true)).toBe(false);
      expect(toolAllowed("tech", n, true)).toBe(false);
      expect(WORK_ACTION_SCHEMAS[n]).toBeTruthy();
    }
    expect(filterTools("admin", [t("parent_overview"), t("open_live_map")]).dropped).toEqual(["parent_overview"]);
    expect(routedCallAllowed("admin", "parent_overdue", {}, false)).toBe(false);
    expect(routedCallAllowed("admin", "run_plan", { steps: [{ action: "parent_overview" }] }, false)).toBe(false);
    expect(toolAllowed("admin", "update_settings", true)).toBe(false);
  });
  it("summarises across companies and flags the most overdue", () => {
    const msg = parentSummary([row({ company: "Massair", leads_today: 2, overdue_value: 100, outstanding: 300 }), row({ company: "AB", leads_today: 1, overdue_value: 900, outstanding: 900, followups_pending: 1 })], fmt);
    expect(msg).toContain("Across 2 companies: 3 leads today");
    expect(msg).toContain("Most overdue: AB (R900)");
    expect(msg).toContain("1 payment follow-up waiting");
  });
  it("handlers only read through the gated RPCs", async () => {
    const rpc = vi.fn(async (name: string) => name === "parent_overview" ? { data: { companies: [row({ company: "AB Refrigeration" })] }, error: null } : { data: [], error: null });
    const h = makeParentHandlers({ db: { rpc, from: () => { throw new Error("no table access"); } }, fmtRand: fmt, navigate: () => {} });
    expect((await h.parent_overview()).ok).toBe(true);
    expect((await h.parent_company_report({ company: "ab" })).message).toContain("AB Refrigeration");
    expect((await h.parent_overdue()).message).toBe("No overdue invoices in any company.");
    const denied = makeParentHandlers({ db: { rpc: async () => ({ data: null, error: { message: "Top-level Mandy is for the Massair owner only." } }) }, fmtRand: fmt, navigate: () => {} });
    expect((await denied.parent_overview()).ok).toBe(false);
  });
});

describe("plans (phase 6)", () => {
  it("prices R4 500 up to 3 users then R149 each", () => {
    expect(planMonthlyZar(1)).toBe(4500);
    expect(planMonthlyZar(3)).toBe(4500);
    expect(planMonthlyZar(8)).toBe(4500 + 5 * 149);
  });
  it("Mandy switches off when paused or disabled", () => {
    expect(mandyPlanOff({ mandy_enabled: true, plan_status: "active" })).toBe(false);
    expect(mandyPlanOff({ mandy_enabled: true, plan_status: "grace" })).toBe(false);
    expect(mandyPlanOff({ mandy_enabled: false, plan_status: "active" })).toBe(true);
    expect(mandyPlanOff({ mandy_enabled: true, plan_status: "suspended" })).toBe(true);
  });
  it("contract terms state 36 months, flat price and 7-day grace", () => {
    const t = contractTerms({ base: 4500, included: 3, extra: 149, months: 36 }).join(" ");
    expect(t).toContain("36 months");
    expect(t).toContain("R4 500");
    expect(t).toContain("R149");
    expect(t).toContain("7-day grace");
  });
});
