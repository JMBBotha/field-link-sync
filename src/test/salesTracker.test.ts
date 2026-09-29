import { describe, expect, it } from "vitest";
import { groupTracker, repsOf, salespersonHistory, salespersonHistoryText, totalsOf, type TrackerRow } from "@/lib/salesTracker";

const row = (p: Partial<TrackerRow>): TrackerRow => ({
  grp: "pipeline", frozen: false, snapshot_id: null, quote_id: "q", quote_number: "Q-1", rep_id: "pieter", rep_name: "Pieter",
  percent: 50, items_sell_ex_vat: 1000, items_cost: 600, items_profit: 400, commission: 200, unknown_cost_count: 0,
  accepted_at: null, earned_at: null, invoice_paid_date: null, paid_at: null, ...p,
});

describe("sales tracker", () => {
  const rows = [
    row({ quote_id: "a", grp: "pipeline" }),
    row({ quote_id: "b", grp: "earned", frozen: true, snapshot_id: "s1", commission: 150.5, items_profit: 301 }),
    row({ quote_id: "c", grp: "paid_out", frozen: true, snapshot_id: "s2", rep_id: "lisa", rep_name: "Lisa" }),
  ];
  it("groups in pipeline → earned → paid out order with totals", () => {
    const g = groupTracker(rows);
    expect(g.map((x) => x.key)).toEqual(["pipeline", "earned", "paid_out"]);
    expect(g[1].totals).toEqual({ count: 1, items_sell: 1000, items_cost: 600, items_profit: 301, commission: 150.5 });
  });
  it("filters to one rep", () => {
    const g = groupTracker(rows, "lisa");
    expect(g.map((x) => x.rows.length)).toEqual([0, 0, 1]);
  });
  it("totals treat null as 0", () => {
    expect(totalsOf([row({ commission: null, items_cost: null })]).commission).toBe(0);
  });
  it("lists reps by name", () => {
    expect(repsOf(rows)).toEqual([{ id: "lisa", name: "Lisa" }, { id: "pieter", name: "Pieter" }]);
  });
});

describe("salesperson history", () => {
  it("collapses the app + trigger duplicate of one change and keeps real changes", () => {
    const h = salespersonHistory([
      { old_status: "p", new_status: "l", changed_by: "j", created_at: "2026-09-29T10:00:00Z" },
      { old_status: "p", new_status: "l", changed_by: "j", created_at: "2026-09-29T10:00:01Z" },
      { old_status: "l", new_status: "p", changed_by: "j", created_at: "2026-09-30T10:00:00Z" },
    ]);
    expect(h).toHaveLength(2);
    const text = salespersonHistoryText(h, { p: "Pieter", l: "Lisa", j: "Johan" });
    expect(text.startsWith("Pieter → Lisa (29 ")).toBe(true);
    expect(text).toContain("2026, by Johan) · Lisa → Pieter (30 ");
  });
  it("is empty without entries", () => {
    expect(salespersonHistoryText(salespersonHistory([]), {})).toBe("");
  });
});
