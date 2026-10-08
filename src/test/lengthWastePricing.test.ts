import { describe, it, expect, afterEach } from "vitest";
import { setActiveQuoteMarkupRates, setActiveMaterialsWastePercent } from "@/lib/pricing";
import { lengthLinePrice, quoteLineDrift } from "@/lib/priceGuard";
import { catalogLineFields, isAirConditioningProduct, metreLineTotal, planStandardInstall } from "@/lib/mandy/quoteOps";
import { chargeQty, buildCopperKit } from "@/lib/voiceQuoteKit";
import { r0Quote } from "@/lib/zeroPriceGuard";
import { isConsumable } from "@/components/quoting/QuoteQuickEditor";
import { packQtyText } from "@/lib/packingList";
import type { PaletteProduct } from "@/components/catalog/QuoteBuilderTab";

const oss = (code: string, name: string, cost: number, len: number) => ({
  id: code, product_code: code, short_name: name, product_category: "Consumables", category: "Consumables",
  cost_price: cost, cost_excl_vat: cost, sold_in_length: true, unit_length: len, price_per_metre: cost / len,
  default_markup_percent: 100, supplier_name: "ONE STOP SHOP", supplier_type: "consumables",
}) as unknown as PaletteProduct;
const COPRL001 = oss("COPRL001", "Soft Drawn Copper 1/4 Inch", 800.87, 15.24);
const IT009 = oss("IT009", "Armaflex 1/4", 200, 1.8);
const TRUNK01 = oss("TRUNK01", "Trunking 60x40", 264.5, 3); // 264.5/3*1.1 = 96.9833 -> x2 = 193.97? see below
const open = () => { setActiveQuoteMarkupRates({ units: 25, materials: 100 }); setActiveMaterialsWastePercent(10); };
afterEach(() => { setActiveQuoteMarkupRates(null); setActiveMaterialsWastePercent(null); });

describe("One Stop Shop length items: per metre + waste", () => {
  it("COPRL001: R115.61/m, cost 57.8056, 5 m = 578.05, no drift warning", () => {
    open();
    expect(lengthLinePrice(COPRL001, 10, 100)).toMatchObject({ costPerM: 57.8056, sellPerM: 115.61 });
    const f = catalogLineFields(COPRL001, 5);
    expect(f.unit_price).toBe(115.61);
    expect(f.metadata).toMatchObject({ unit_cost: 57.8056, qty_unit: "metre", supplier_length_m: 15.24, waste_percent: 10, quote_category: "materials", markup_percent: 100 });
    expect(f.total_price).toBe(578.05);
    expect(quoteLineDrift({ item_type: "Consumables", item_name: f.item_name, quantity: 5, unit_price: f.unit_price, metadata: f.metadata }, COPRL001)).toBeNull();
  });
  it("TRUNK01 3 m = 290.94 and DPIPE01 standard install 4 m = 61.60", () => {
    open();
    const T = oss("TRUNK01", "Trunking", 132.25, 3); // 132.25/3*1.1 = 48.4917 -> 96.98/m
    expect(catalogLineFields(T, 3).total_price).toBe(290.94);
    const D = oss("DPIPE01", "Drain pipe 20mm", 28, 4); // 7*1.1 = 7.70 -> 15.40/m
    const plan = planStandardInstall({ short_name: "Midea 12K INV", product_category: "Air Conditioning", btu_rating: 12000 } as any,
      [{ id: "t", name: "12K", min_btu: 9000, max_btu: 14000, items: [{ role: "drain", product_code: "DPIPE01", default_qty: 1, included: true }] } as any], [], [D]);
    const line = plan.lines.find((l) => l.product.product_code === "DPIPE01")!;
    expect(line.qty).toBe(4);
    expect(catalogLineFields(D, line.qty).total_price).toBe(61.6);
    void TRUNK01;
  });
  it("voice copper run 5 m charges 5 m (no x1.10 qty)", () => {
    open();
    expect(chargeQty(5)).toBe(5);
    const k = buildCopperKit("1/4", 5, [COPRL001, IT009]);
    expect(k.lines[0].quantity).toBe(5);
    expect(k.lines[0].unitPrice).toBe(115.61);
  });
  it("material picker keeps consumables only; consumable is never an AC unit", () => {
    expect(isConsumable(COPRL001 as any)).toBe(true);
    expect(isConsumable({ supplier_type: "ac_units" })).toBe(false);
    expect(isAirConditioningProduct({ ...COPRL001, short_name: "Aircon copper", supplier_type: "consumables" } as any)).toBe(false);
  });
  it("0 m metre line is blocked like R0", () => {
    expect(r0Quote([{ item_name: "Copper", unit_price: 115.61, quantity: 0, metadata: { qty_unit: "metre" } }])).toBe("Copper");
    expect(r0Quote([{ item_name: "Copper", unit_price: 115.61, quantity: 0.1, metadata: { qty_unit: "metre" } }])).toBeNull();
  });
  it("old trunking metre lines (no waste_percent) keep the per-length maths", () => {
    expect(metreLineTotal({ unit_price: 88.1667, metadata: { qty_unit: "metre", supplier_length_m: 3 } }, 3)).toBe(264.5);
    expect(metreLineTotal({ unit_price: 115.61, metadata: { qty_unit: "metre", supplier_length_m: 15.24, waste_percent: 10 } }, 5)).toBe(578.05);
  });
  it("packing list shows metres and coils, no prices", () => {
    expect(packQtyText({ quantity: 5, qty_unit: "metre", supplier_length_m: 15.24, item_name: "Soft Drawn Copper", item_code: "COPRL001" })).toBe("5 m (1 x 15.24 m coil)");
    expect(packQtyText({ quantity: 4, qty_unit: "metre", supplier_length_m: 3, item_name: "Trunking", item_code: "TRUNK01" })).toBe("4 m (2 x 3 m length)");
    expect(packQtyText({ quantity: 3, item_name: "Bracket", item_code: "B" })).toBe("× 3");
  });
});
