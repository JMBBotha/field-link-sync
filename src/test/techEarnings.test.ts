import { describe, expect, it } from "vitest";
import { actionsFor, netOf, summarize, techsOf, type TechEarningRow } from "@/lib/techEarnings";

const row = (o: Partial<TechEarningRow>): TechEarningRow => ({
  id: "r1", frozen: true, job_id: "j1", quote_id: "q1", quote_number: "Q-1", tech_id: "t1", tech_name: "Thabo",
  bucket: "paid_on_completion", percent: 40, amount: 200, reduction_amount: 0, net_amount: 200, status: "payable",
  completed_at: "2026-09-29T10:00:00Z", release_after: null, releasable: false, callback_job_id: null, paid_at: null, ...o,
});

describe("techEarnings", () => {
  const rows = [
    row({}),
    row({ id: "r2", bucket: "holdback", percent: 10, amount: 50, net_amount: 50, status: "held", release_after: "2026-11-13" }),
    row({ id: "r3", tech_id: "t2", tech_name: "Ayesha", bucket: "holdback", amount: 50, reduction_amount: 20, net_amount: 30, status: "reduced" }),
    row({ id: null, frozen: false, tech_id: "t2", tech_name: "Ayesha", status: "accrued", amount: 100, net_amount: 100 }),
  ];

  it("sums paid and held separately, net of reductions", () => {
    const [paid, held] = summarize(rows);
    expect(paid.total).toBe(300);
    expect(held.total).toBe(80);
    expect(paid.byStatus.find((s) => s.status === "accrued")?.amount).toBe(100);
    expect(held.byStatus.find((s) => s.status === "reduced")?.amount).toBe(30);
  });

  it("filters by tech", () => {
    const [paid, held] = summarize(rows, "t1");
    expect(paid.total).toBe(200);
    expect(held.total).toBe(50);
  });

  it("net falls back to amount minus reduction", () => {
    expect(netOf(row({ net_amount: null, amount: 50, reduction_amount: 20 }))).toBe(30);
  });

  it("lists techs by name", () => {
    expect(techsOf(rows).map((t) => t.name)).toEqual(["Ayesha", "Thabo"]);
  });

  it("only the owner gets actions, per status", () => {
    expect(actionsFor(rows[0], false)).toEqual([]);
    expect(actionsFor(rows[0], true)).toEqual(["paid"]);
    expect(actionsFor(row({ status: "paid" }), true)).toEqual(["unpay"]);
    expect(actionsFor(rows[1], true)).toEqual(["reduce"]);
    expect(actionsFor({ ...rows[1], releasable: true }, true)).toEqual(["release", "reduce"]);
    expect(actionsFor(rows[2], true)).toEqual(["undo"]);
    expect(actionsFor(rows[3], true)).toEqual([]);
  });
});
