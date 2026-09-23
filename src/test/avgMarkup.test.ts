import { describe, it, expect } from "vitest";
import { computeQuoteTotals } from "@/utils/quoteTransformers";
import { computeBasketsQuoteTotals, lineMarkupPercent } from "@/utils/quoteBasketTotals";

const line = (id: string, cat: string, cost: number, sell: number, bundle = false) => ({
  id, quote_id: "q", area_id: "a1", parent_item_id: null, product_id: null, item_name: id,
  item_number: null, description: null, quantity: 1, length: null, unit_price: sell,
  total_price: sell, is_bundle: bundle, item_type: cat, metadata: { total_cost: cost },
}) as any;

describe("Avg. Markup = blended markup on cost", () => {
  it("AC 20000 @25% + kit 2000 @100% → 31.8%", () => {
    const t = computeQuoteTotals(
      [line("ac", "Air Conditioning", 20000, 25000), line("kit", "Installation Kit", 2000, 4000, true)],
      [{ id: "a1", name: "Living" } as any],
    );
    expect(t.avgMarkup).toBeCloseTo((7000 / 22000) * 100, 5);
    expect(t.avgMarkup).not.toBeCloseTo(62.5, 0);
    expect(t.unitsMarkup).toBeCloseTo(25, 5);
    expect(t.materialsMarkup).toBeCloseTo(100, 5);
  });

  it("basket path matches", () => {
    const ac: any = { instanceId: "ac", quantity: 1, product: { id: "p", product_code: "AC", product_category: "Air Conditioning", cost_price: 20000, default_markup_percent: 25, locked_sell_ex_vat: 25000, locked_cost_ex_vat: 20000 } };
    const kit: any = { instanceId: "k", quantity: 1, length: 2, isBundle: true, bundlePricingType: "p/meter", bundleUnitPrice: 2000, bundleUnitCost: 1000, product: { id: "kit-x", product_code: "KIT", product_category: "Installation Kit", cost_price: 1000 } };
    expect(lineMarkupPercent(kit)).toBe(100);
    const t = computeBasketsQuoteTotals([{ id: "a1", name: "Living", items: [ac, kit] } as any]);
    expect(t.avgMarkup).toBeCloseTo(31.82, 1);
  });
});
