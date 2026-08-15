import { describe, expect, it } from "vitest";
import { calculatePrices, type PriceConfig } from "../components/catalog/PriceConfigPanel";

const baseConfig: PriceConfig = {
  selectedPriceColumn: "price",
  priceIncludesVat: false,
  priceIncludesMarkup: false,
  supplierMarkupPercent: 0,
  supplierDiscountPercent: 0,
  yourMarkupPercent: 25,
  vatRate: 15,
};

describe("calculatePrices", () => {
  it("generic supplier with a true built-in markup on cost: divides it out before applying our resale markup", () => {
    // Generic case for a supplier whose PDF price is genuinely cost * (1 +
    // markup%) -- e.g. a recommended-retail-style list built up FROM cost.
    // NOT Samsung: see the discount test below for Samsung's actual structure.
    const config: PriceConfig = { ...baseConfig, priceIncludesMarkup: true, supplierMarkupPercent: 20 };
    const result = calculatePrices(1200, config); // PDF price already includes the 20% markup
    expect(result.trueCost).toBeCloseTo(1000, 2); // 1200 / 1.20
    expect(result.sellingPrice).toBeCloseTo(1250, 2); // 1000 * 1.25
  });

  it("Samsung scenario: a 20% trade discount off list price, which exactly round-trips with a 25% resale markup", () => {
    // Regression guard for the Aug 2026 Samsung pricing bug and its
    // corrected fix: Samsung's PDF shows a LIST price. Our true cost is the
    // list price minus a 20% trade discount (NOT list / 1.20 -- that is a
    // different, incorrect formula that was briefly and wrongly applied and
    // then reverted). Because 0.80 * 1.25 == 1.0 exactly, cost * 1.25 lands
    // back on the original list price -- this is the empirical signature
    // that confirmed the discount formula (not the markup-divide formula)
    // is the correct one for Samsung.
    const config: PriceConfig = { ...baseConfig, supplierDiscountPercent: 20, yourMarkupPercent: 25 };
    const result = calculatePrices(22694.78, config); // Samsung PDF list price
    expect(result.trueCost).toBeCloseTo(18155.82, 1);
    expect(result.sellingPrice).toBeCloseTo(22694.78, 1); // round-trips to the original list price
  });

  it("keeps costExclVat in sync with trueCost/cost_price (the write-time invariant)", () => {
    // This is the exact bug this fix addresses: costExclVat used to return
    // the raw, un-stripped list price instead of the adjusted true cost,
    // which corrupted any read path that preferred cost_excl_vat.
    const config: PriceConfig = { ...baseConfig, priceIncludesMarkup: true, supplierMarkupPercent: 20 };
    const result = calculatePrices(1200, config);
    expect(result.costExclVat).toBe(result.trueCost);
  });

  it("applies a trade discount correctly when the PDF shows list price, not a built-in markup", () => {
    const config: PriceConfig = { ...baseConfig, supplierDiscountPercent: 20 };
    const result = calculatePrices(1000, config); // list price, 20% trade discount off
    expect(result.trueCost).toBeCloseTo(800, 2);
    expect(result.costExclVat).toBe(result.trueCost);
  });

  it("passes the price through unchanged when the supplier PDF is already true cost price", () => {
    const result = calculatePrices(500, baseConfig);
    expect(result.trueCost).toBe(500);
    expect(result.costExclVat).toBe(500);
    expect(result.sellingPrice).toBeCloseTo(625, 2); // 500 * 1.25
  });

  it("strips VAT before stripping a built-in markup, per the documented order of operations", () => {
    const config: PriceConfig = { ...baseConfig, priceIncludesVat: true, priceIncludesMarkup: true, supplierMarkupPercent: 20, vatRate: 15 };
    const rawPrice = 1200 * 1.15; // VAT-inclusive PDF price for the Samsung scenario above
    const result = calculatePrices(rawPrice, config);
    expect(result.trueCost).toBeCloseTo(1000, 1);
  });
});
