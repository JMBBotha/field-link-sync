import { describe, it, expect } from "vitest";
import { limitTone, goalsFrom, DEFAULT_GOALS, changeLabel, quotesNotFollowedUp, depositsWaiting, DAY } from "@/lib/dashboardNumbers";
describe("R4 number row rules", () => {
  it("neutral by default, amber close to limit, red past it", () => {
    expect(limitTone(0, 0)).toBe("neutral"); expect(limitTone(1, 0)).toBe("red");
    expect(limitTone(1, 3)).toBe("neutral"); expect(limitTone(2, 3)).toBe("amber"); expect(limitTone(3, 3)).toBe("amber"); expect(limitTone(4, 3)).toBe("red");
  });
  it("goals fall back to defaults", () => { expect(goalsFrom(null)).toEqual(DEFAULT_GOALS); expect(goalsFrom({ jobsGoal: "12" }).jobsGoal).toBe(12); });
  it("change names its period", () => { expect(changeLabel(5, 2, "last week")).toBe("+3 vs last week"); });
  it("counts stale quotes and late deposits", () => {
    const now = Date.now(); const old = new Date(now - 8 * DAY).toISOString();
    expect(quotesNotFollowedUp([{ stage: "sent", quote: { updated_at: old } }, { stage: "accepted", quote: { updated_at: old } }], now)).toBe(1);
    expect(depositsWaiting([{ depositDue: true, quote: { accepted_at: old } }], now)).toBe(1);
  });
});
