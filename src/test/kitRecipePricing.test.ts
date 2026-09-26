import { describe, it, expect, afterEach } from "vitest";
import { computeBundlePricing, bundlePopoverRows, bundlePieceUnitPrices } from "@/components/catalog/quote-builder/BundleItemsPopover";
import { buildKitSubItems } from "@/components/catalog/quote-builder/kitLine";
import { getEffectiveUnitPrices } from "@/components/catalog/QuoteBuilderTab";
import { kitRowFields } from "@/lib/mandy/quoteOps";
import { setActiveQuoteMarkupRates } from "@/lib/pricing";

// Live book costs (One Stop Shop), 100% markup.
const p = (code: string, pack: number, len: number, perKit = 1) => ({
  quantity: perKit, length_metres: perKit, is_length_item: true, is_optional: false,
  product: { id: code, product_code: code, short_name: code, product_category: "Consumables", category: "Consumables",
    cost_price: pack, cost_excl_vat: pack, price_per_metre: pack / len, sold_in_length: true, unit_length: len,
    default_markup_percent: 100, supplier_name: "One Stop" },
});
const TIES_PRODUCT = { id: "CAT003", product_code: "CAT003", short_name: "Cable ties", product_category: "Consumables", category: "Consumables",
  cost_price: 162.68, cost_excl_vat: 162.68, price_per_metre: null, sold_in_length: false, unit_length: null,
  unit_type: "pack", price_per_unit_qty: 100, pack_qty: null, default_markup_percent: 100, supplier_name: "One Stop" };
const TIES = { quantity: 2, length_metres: null, is_length_item: false, is_optional: false, product: TIES_PRODUCT };
const CU14 = p("COPRL001", 800.87, 15.24), CU38 = p("COPRL002", 1265.44, 15.24);
const CU12 = p("COPRL003", 1696.25, 15.24), CU58 = p("COPRL004", 2163.06, 15.24);
const I9 = p("IT009", 11.89, 1.8), I10 = p("IT010", 15.46, 1.8), I11 = p("IT011", 17.01, 1.8), I12 = p("IT012", 19.78, 1.8);
const TAPE = p("TAPE006", 64.28, 30, 0.3333333333);
const K09 = { id: "k09", name: "09K", items: [CU14, CU38, I9, I10, TAPE, TIES] };
const K12 = { id: "k12", name: "12K", items: [CU14, I9, CU12, I11, TAPE, TIES] };
const K18 = { id: "k18", name: "18K", items: [CU14, CU12, I9, I11, TAPE, TIES] };
const K2412 = { id: "k2412", name: "24K 3/8+1/2", items: [CU38, CU12, I10, I11, TAPE, TIES] };
const K2458 = { id: "k2458", name: "24K 3/8+5/8", items: [CU58, CU38, I10, I12, TAPE, TIES] };

afterEach(() => setActiveQuoteMarkupRates(null));
const on = () => setActiveQuoteMarkupRates({ units: 25, materials: 100 } as any);

describe("piping kit recipe + per-piece pack items", () => {
  it.each([
    [K09, 309.49, 928.48],
    [K12, 367.75, 1103.26],
    [K18, 367.75, 1103.26],
    [K2412, 432.69, 1298.06],
    [K2458, 497.03, 1491.08],
  ])("%s per-metre and 3 m price", (k: any, perM, threeM) => {
    on();
    const { pricingType, unitPrice, unitCost } = computeBundlePricing(buildKitSubItems(k));
    expect(pricingType).toBe("p/meter");
    expect(Number(unitPrice.toFixed(2))).toBe(perM);
    expect(unitPrice).toBeCloseTo(unitCost * 2, 6);
    expect(kitRowFields(k, 1).fields.unit_price).toBe(perM);
    expect(kitRowFields(k, 3).fields.unit_price).toBe(threeM);
  });

  it("3 m kit: 6 ties at R3.2536 (R19.52) and 1.000 m tape", () => {
    on();
    const subs = buildKitSubItems(K09 as any, 3);
    const ties = subs.find((s) => s.product.product_code === "CAT003")!;
    expect(ties.quantity).toBe(6);
    expect(bundlePieceUnitPrices(ties.product).unitSell).toBeCloseTo(3.2536, 4);
    expect(Number((bundlePieceUnitPrices(ties.product).unitSell * ties.quantity).toFixed(2))).toBe(19.52);
    const tape = subs.find((s) => s.product.product_code === "TAPE006")!;
    expect((tape.perKitMetre ?? 0) * 3).toBeCloseTo(1, 6);
  });

  it("pack item priced per piece in kit + popover, per pack standalone", () => {
    on();
    const subs = buildKitSubItems(K09 as any);
    const { unitPrice, pricingType } = computeBundlePricing(subs);
    const rows = bundlePopoverRows(subs, pricingType);
    const tieRow = rows.find((r) => r.item.product.product_code === "CAT003")!;
    expect(tieRow.sellPerUnit).toBeCloseTo(3.2536, 4);
    expect(tieRow.qtyOrLen).toBe(2);
    expect(tieRow.lineTotal).toBeCloseTo(6.5072, 4);
    expect(rows.reduce((s, r) => s + r.lineTotal, 0)).toBeCloseTo(unitPrice, 8);
    // Standalone catalog line still per pack
    expect(getEffectiveUnitPrices(TIES_PRODUCT as any, false).unitSell).toBeCloseTo(325.36, 2);
  });

  it("perKitMetre from length_metres ?? quantity ?? 1", () => {
    expect(buildKitSubItems({ id: "x", name: "x", items: [{ ...TAPE, length_metres: null, quantity: 2 }] } as any)[0].perKitMetre).toBe(2);
  });
});
