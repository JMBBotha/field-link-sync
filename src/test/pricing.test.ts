import { describe, expect, it } from "vitest";
import { calcSellingPrice, getProductPricing, computePricing, netCostFromList, resolveRowCostExVat } from "../lib/pricing";

describe("calcSellingPrice", () => {
  it("applies markup to cost_price with NO re-discounting (cost_price is already net)", () => {
    // Regression guard for the Aug 13 2026 bug: a previous version of
    // src/lib/pricing.ts re-applied a hardcoded SUPPLIER_DISCOUNTS table on
    // top of cost_price even though every write path already stores
    // cost_price net of any supplier trade discount. That silently
    // underpriced every Samsung line item by ~20%. See
    // docs/pricing-and-import-architecture-findings.md for the full
    // writeup. This test locks in the correct, verified behavior: the
    // selling price is cost_price * (1 + markup), full stop.
    const { sellingExclVat } = calcSellingPrice(800, 35); // Samsung net cost R800
    expect(sellingExclVat).toBe(1080); // NOT 864 (which would mean discount was re-applied)
  });

  it("adds 15% VAT on top of the selling price", () => {
    const { sellingExclVat, vatAmount, sellingInclVat } = calcSellingPrice(1000, 35);
    expect(sellingExclVat).toBe(1350);
    expect(vatAmount).toBe(202.5);
    expect(sellingInclVat).toBe(1552.5);
  });

  it("guards against NaN cost_price instead of propagating garbage", () => {
    const { sellingExclVat } = calcSellingPrice(NaN, 35);
    expect(sellingExclVat).toBe(0);
  });

  it("guards against negative cost_price", () => {
    const { sellingExclVat } = calcSellingPrice(-500, 35);
    expect(sellingExclVat).toBe(0);
  });

  it("clamps an absurd markup instead of producing a runaway price", () => {
    const { sellingExclVat } = calcSellingPrice(100, 999999);
    // markup clamped to 500%
    expect(sellingExclVat).toBe(600);
  });

  it("falls back to the standard 35% markup when markup is NaN", () => {
    const { sellingExclVat } = calcSellingPrice(100, NaN);
    expect(sellingExclVat).toBe(135);
  });
});

describe("getProductPricing", () => {
  it("returns a consistent shape derived from calcSellingPrice", () => {
    const result = getProductPricing(800, 35);
    expect(result.sellingPrice).toBe(1080);
    expect(result.profit).toBe(280);
  });
});

describe("computePricing", () => {
  it("trusts overrideCostExVat (product.cost_price) directly, never re-discounting", () => {
    const result = computePricing("SAMSUNG", 1000, 35, 800);
    expect(result.costExVat).toBe(800);
    expect(result.sellExVat).toBe(1080);
  });

  it("falls back to listPriceExVat only when no cost override is present", () => {
    const result = computePricing("OTHER", 500, 35, null);
    expect(result.costExVat).toBe(500);
    expect(result.sellExVat).toBe(675);
  });

  it("guards against a NaN/garbage override instead of producing NaN pricing", () => {
    const result = computePricing("SAMSUNG", 500, 35, NaN as unknown as number);
    expect(Number.isFinite(result.costExVat)).toBe(true);
    expect(Number.isFinite(result.sellExVat)).toBe(true);
  });
});

describe("list -> discount -> markup identity (Samsung pattern)", () => {
  it("returns exactly the list price for 20% discount + 25% markup", () => {
    const list = 10000;
    const cost = netCostFromList(list, 20);
    const { sellingExclVat } = calcSellingPrice(cost, 25);
    expect(sellingExclVat).toBe(10000);
  });

  it("holds the identity on an awkward real Samsung list price", () => {
    const list = 15825.23; // AR18BSHCMWK/FA
    const cost = netCostFromList(list, 20);
    const { sellingExclVat } = calcSellingPrice(cost, 25);
    expect(Math.abs(sellingExclVat - list)).toBeLessThanOrEqual(0.01);
  });

  it("trusts a stored (already-discounted) cost_price and never re-discounts it", () => {
    const cost = resolveRowCostExVat(
      { cost_price: 12660.18, supplier_discount_percent: 20 },
      15825.23,
    );
    expect(cost).toBe(12660.18);
    expect(calcSellingPrice(cost, 25).sellingExclVat).toBe(15825.23);
  });

  it("treats a PDF list price as list (not cost) when there is no stored cost", () => {
    const cost = resolveRowCostExVat({ cost_price: 0, supplier_discount_percent: 20 }, 10000);
    expect(cost).toBe(8000);
    expect(calcSellingPrice(cost, 25).sellingExclVat).toBe(10000);
  });
});
