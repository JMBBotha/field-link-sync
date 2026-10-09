import { describe, expect, it } from "vitest";
import { PLAN_PRESETS, isValidPlan, planSummary, planTermsSentence, stageOf } from "./paymentPlans";

describe("payment plans", () => {
  it("presets are valid and sum to 100", () => {
    for (const p of PLAN_PRESETS) expect(isValidPlan(p)).toBe(true);
    expect(isValidPlan({ name: "x", stages: [{ pct: 50 }, { pct: 40 }] })).toBe(false);
    expect(isValidPlan(null)).toBe(false);
  });
  it("summarises plans and the default", () => {
    expect(planSummary(PLAN_PRESETS[3])).toBe("20% deposit · 60% progress payment · 20% balance on completion");
    expect(planSummary(null, 70)).toBe("70% deposit · 30% balance on completion");
  });
  it("writes the terms sentence", () => {
    expect(planTermsSentence(PLAN_PRESETS[3], 70, 30)).toBe("Payments: 20% deposit on acceptance, 60% progress payment as the work progresses, and the final 20% within 30 days of completion.");
    expect(planTermsSentence(PLAN_PRESETS[1], 70, 14)).toBe("Payments: 65% deposit on acceptance, and the final 35% within 14 days of completion.");
    expect(planTermsSentence(null, 70, 30)).toBe("A 70% deposit is payable on acceptance; the balance is due within 30 days of completion.");
  });
  it("reads stage numbers", () => {
    expect(stageOf("STAGE 2/3 — 60% of quote Q-1")).toBe(2);
    expect(stageOf("DEPOSIT — 20%")).toBeNull();
  });
});

describe("custom split", () => {
  it("parses valid splits and rejects bad ones", async () => {
    const { parsePlan } = await import("./paymentPlans");
    expect(parsePlan("40/40/20")?.stages.map((s) => s.pct)).toEqual([40, 40, 20]);
    expect(parsePlan("40/40/20")?.stages[1].label).toBe("Progress payment");
    expect(parsePlan("30 70")?.name).toBe("30/70");
    expect(parsePlan("50/40")).toBeNull();
    expect(parsePlan("100")).toBeNull();
    expect(parsePlan("10/10/10/10/60")).toBeNull();
  });
});
