import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { jobsByWeek, lastWeeks, monthCompare, weekStart, type MyEarningRow } from "@/lib/myEarnings";
const row = (o: Partial<MyEarningRow>): MyEarningRow => ({ row_key: Math.random().toString(), job_id: "j1", job_name: "TEST", job_date: "2026-10-10", hours: 2, kind: "completion", status: "paid", amount: 100, release_after: null, paid_at: null, ...o });
const now = new Date("2026-10-10T08:00:00Z");

describe("engaging My earnings (Johan 10:41)", () => {
  it("month vs last month", () => {
    expect(monthCompare([row({ amount: 300 }), row({ job_date: "2026-09-15", amount: 100 })], now)).toMatchObject({ current: 300, last: 100, diff: 200, trend: "up" });
    expect(monthCompare([row({ job_date: "2026-09-15", amount: 100 })], now).trend).toBe("down");
  });
  it("8 weekly buckets, current week last, Monday starts", () => {
    expect(weekStart("2026-10-10")).toBe("2026-10-05");
    const w = lastWeeks([row({ amount: 50 }), row({ job_date: "2026-09-01", amount: 70 }), row({ job_date: "2026-01-01", amount: 999 })], 8, now);
    expect(w).toHaveLength(8);
    expect(w[7]).toEqual({ start: "2026-10-05", total: 50 });
    expect(w.reduce((a, x) => a + x.total, 0)).toBe(120); // 1 Sep inside the 8-week window, Jan outside
  });
  it("jobs grouped by week, newest first, undated last", () => {
    const g = jobsByWeek([row({ job_id: "a", job_date: "2026-09-29" }), row({ job_id: "b" }), row({ job_id: "c", job_date: null })]);
    expect(g.map((x) => x.start)).toEqual(["2026-10-05", "2026-09-28", "undated"]);
  });
  it("big Back (history or /field fallback) and money-safe view", () => {
    const src = readFileSync("src/components/field/MyEarnings.tsx", "utf8");
    expect(src).toMatch(/history\.state\?\.idx \?\? 0\) > 0 \? navigate\(-1\) : navigate\("\/field"\)/);
    expect(src).toMatch(/<BigBack \/>/);
    expect(src).not.toMatch(/percent|quote_number|invoice/i);
  });
});
