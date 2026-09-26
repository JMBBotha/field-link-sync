import { describe, it, expect, afterEach } from "vitest";
import { computeBundlePricing } from "@/components/catalog/quote-builder/BundleItemsPopover";
import { buildKitSubItems } from "@/components/catalog/quote-builder/kitLine";
import { getEffectiveUnitPrices } from "@/components/catalog/QuoteBuilderTab";
import { computeLineTotal, resolvePricingUnit } from "@/lib/pricingUnits";
import { kitRowFields } from "@/lib/mandy/quoteOps";
import { setActiveQuoteMarkupRates } from "@/lib/pricing";

const p = (code: string, pack: number, len: number, perKit = 1) => ({
  quantity: 1, length_metres: perKit, is_length_item: true, is_optional: false,
  product: { id: code, product_code: code, short_name: code, product_category: "Consumables", category: "Consumables",
    cost_price: pack, cost_excl_vat: pack, price_per_metre: pack / len, sold_in_length: true, unit_length: len,
    default_markup_percent: 100, supplier_name: "One Stop" },
});
const CU14 = p("COPRL001", 800.87, 15.24), CU38 = p("COPRL002", 1265.44, 15.24);
const CU12 = p("COPRL003", 111.3 * 15.24, 15.24), CU58 = p("COPRL004", 141.93 * 15.24, 15.24);
const I9 = p("IT009", 11.89, 1.8), I10 = p("IT010", 15.46, 1.8), I11 = p("IT011", 9.45 * 1.8, 1.8), I12 = p("IT012", 10.99 * 1.8, 1.8);
const TAPE = p("TAPE006", 64.28, 30);
const K09 = { id: "k09", name: "09K", items: [CU14, CU38, I9, I10, { ...TAPE, length_metres: 0.5 }] };
const K12 = { id: "k12", name: "12K", items: [CU14, CU12, I9, I11, TAPE] };
const K2412 = { id: "k2412", name: "24K 3/8+1/2", items: [CU38, CU12, I10, I11, TAPE] };
const K2458 = { id: "k2458", name: "24K 3/8+5/8", items: [CU58, CU38, I10, I12, TAPE] };

afterEach(() => setActiveQuoteMarkupRates(null));
const on = () => setActiveQuoteMarkupRates({ units: 25, materials: 100 } as any);

describe("kit recipe (bundle_items.length_metres) in per-metre pricing", () => {
  it("perKitMetre from length_metres ?? quantity ?? 1", () => {
    const s = buildKitSubItems(K09 as any);
    expect(s.map((i) => i.perKitMetre)).toEqual([1, 1, 1, 1, 0.5]);
    expect(buildKitSubItems({ id: "x", name: "x", items: [{ ...TAPE, length_metres: null, quantity: 2 }] } as any)[0].perKitMetre).toBe(2);
  });
  it("09K → R303.70/m; 3 m row R911.10", () => {
    on();
    const { pricingType, unitPrice } = computeBundlePricing(buildKitSubItems(K09 as any));
    expect(pricingType).toBe("p/meter");
    expect(unitPrice).toBeCloseTo(303.70, 2);
    expect(kitRowFields(K09 as any, 3).fields.unit_price).toBeCloseTo(911.10, 2);
  });
  it("other kits unchanged", () => {
    on();
    const r = (k: any) => Number(computeBundlePricing(buildKitSubItems(k)).unitPrice.toFixed(2));
    expect(r(K12)).toBeCloseTo(364.10, 1);
    expect(r(K2412)).toBeCloseTo(429.04, 1);
    expect(r(K2458)).toBeCloseTo(493.38, 1);
  });
  it("popover rows total == line price (09K)", () => {
    on();
    const subs = buildKitSubItems(K09 as any);
    const rows = subs.reduce((s, i) => {
      const { unitSell } = getEffectiveUnitPrices(i.product, i.isLengthItem);
      return s + computeLineTotal(i.perKitMetre ?? 1, unitSell, resolvePricingUnit(i.product));
    }, 0);
    expect(rows).toBeCloseTo(computeBundlePricing(subs).unitPrice, 2);
  });
});
