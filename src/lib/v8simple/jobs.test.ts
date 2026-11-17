import { describe, it, expect } from "vitest";
import { countAdminHome } from "@/lib/adminHomeCount";
import { V8_DEMO_COMPANY, V8_DEMO_EFT, V8_DEMO_INVOICES, V8_DEMO_JOBS } from "@/lib/v8simple/demoJobs";
import { v8FilterJobs, v8JobCounts, v8JobStage, v8MoneyView } from "@/lib/v8simple/jobs";
import { v8Stage } from "@/lib/v8simple/stage";

describe("V8 jobs list", () => {
  it("pill counts match v8Stage", () => {
    const counts = v8JobCounts(V8_DEMO_JOBS);
    for (const key of Object.keys(counts)) {
      const filtered = v8FilterJobs(V8_DEMO_JOBS, key, false);
      expect(filtered).toHaveLength(counts[key]);
      for (const row of filtered) expect(v8JobStage(row).key).toBe(v8Stage(row.input).key);
    }
    expect(counts.deposit_due).toBe(1);
    expect(counts.ready).toBe(1);
    expect(counts.balance_due).toBe(1);
    expect(v8FilterJobs(V8_DEMO_JOBS, "lead", false).some((row) => row.id === "lost-1")).toBe(false);
  });

  it("money view totals match the admin home figures", () => {
    const input = { companyId: V8_DEMO_COMPANY, invoices: V8_DEMO_INVOICES, now: new Date("2026-11-17T08:00:00+02:00") };
    const home = countAdminHome(input);
    const money = v8MoneyView(input, V8_DEMO_EFT);
    expect(money.depositDue).toBe(home.deposit.total);
    expect(money.balanceDue).toBe(home.finalDue.total);
    expect(money.depositDue).toBe(8000);
    expect(money.balanceDue).toBe(22000);
    expect(money.eftToMatch).toBe(4500);
  });
});
