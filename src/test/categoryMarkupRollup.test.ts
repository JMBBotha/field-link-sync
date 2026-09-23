import { describe, it, expect } from "vitest";
import { computeQuoteTotals } from "@/utils/quoteTransformers";

const line = (id: string, type: string, cost: number, markup: number): any => ({
  id, item_type: type, quantity: 1, unit_price: cost * (1 + markup / 100),
  total_price: cost * (1 + markup / 100), metadata: { total_cost: cost, markup_percent: markup },
});

describe("per-line category markup roll-up (Johan worked example)", () => {
  const items = [
    line("u", "air conditioner", 7000, 25),
    line("m", "materials", 2000, 100),
    line("l", "labour", 1000, 100),
  ];
  const t = computeQuoteTotals(items, []);
  it("sums line sells and costs", () => {
    expect(t.subtotal).toBeCloseTo(14750, 2);
    expect(t.totalCost).toBeCloseTo(10000, 2);
    expect(t.profit).toBeCloseTo(4750, 2);
  });
  it("overall markup = 47.5% (not 25, 100, 62.5 or 125)", () => {
    expect(t.avgMarkup).toBeCloseTo(47.5, 5);
    expect(0.7 * 25 + 0.2 * 100 + 0.1 * 100).toBeCloseTo(t.avgMarkup, 5);
  });
  it("overall margin ≈ 32.2% on sell", () => {
    expect(t.marginPercent).toBeCloseTo((4750 / 14750) * 100, 5);
  });
  it("25% markup = 20% margin; 100% markup = 50% margin", () => {
    expect(computeQuoteTotals([line("a", "air conditioner", 100, 25)], []).marginPercent).toBeCloseTo(20, 5);
    expect(computeQuoteTotals([line("b", "materials", 100, 100)], []).marginPercent).toBeCloseTo(50, 5);
  });
});
