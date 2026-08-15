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
  it("Samsung scenario: strips the supplier's built-in 20% markup before applying our resale markup", () => {
    // Regression guard for the Aug 2026 Samsung double-markup bug: Samsung's
    // PDF price already has a 20% distributor markup baked in. If it isn't
    // divided out first, our 25% resale markup gets stacked on top of it,
    // overpricing every quote. See docs for the full writeup.
    const config: PriceConfig = { ...baseConfig, priceIncludesMarkup: true, supplierMarkupPercent: 20 };
    const result = calculatePrices(1200, config); // PDF price already includes the 20% markup
    expect(result.trueCost).toBeCloseTo(1000, 2); // 1200 / 1.20
    expect(result.sellingPrice).toBeCloseTo(1250, 2); // 1000 * 1.25
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
