import { describe, it, expect, afterEach } from "vitest";
import { setActiveQuoteMarkupRates, setActiveMaterialsWastePercent } from "@/lib/pricing";
import { quoteLineDrift } from "@/lib/priceGuard";
import { areasToBaskets } from "@/components/catalog/quote-builder/QuoteBuilderPopup";
import { basketsToQuoteState } from "@/utils/quoteBasketTotals";
import { createEmptyArea } from "@/components/catalog/quote-builder/quoteWizardTypes";
import { newMetreMaterial, isConsumable, isLengthCatalogItem, isMetreStub } from "@/components/catalog/quote-builder/wizard/metreLine";
import type { PaletteProduct } from "@/components/catalog/QuoteBuilderTab";

const COPRL001 = {
  id: "COPRL001", product_code: "COPRL001", short_name: "Soft Drawn Copper 1/4 Inch", product_category: "Consumables", category: "Consumables",
  cost_price: 800.87, cost_excl_vat: 800.87, sold_in_length: true, unit_length: 15.24, price_per_metre: 800.87 / 15.24,
  default_markup_percent: 100, supplier_name: "ONE STOP SHOP", supplier_type: "consumables",
} as unknown as PaletteProduct;
const BRAC01 = { id: "BRAC01", product_code: "BRAC01", short_name: "Bracket", product_category: "Consumables", cost_price: 100, cost_excl_vat: 100,
  default_markup_percent: 100, supplier_name: "ONE STOP SHOP", supplier_type: "consumables" } as unknown as PaletteProduct;

afterEach(() => { setActiveQuoteMarkupRates(null); setActiveMaterialsWastePercent(null); });

describe("Visual PDF wizard: One Stop Shop metre lines", () => {
  it("COPRL001 picked at 5 m saves like the main builder", () => {
    setActiveQuoteMarkupRates({ units: 25, materials: 100 }); setActiveMaterialsWastePercent(10);
    const area = createEmptyArea("Lounge");
    const mat = newMetreMaterial(COPRL001, 5);
    expect(isMetreStub(mat.product)).toBe(true);
    area.materials.push(mat);
    const { items } = basketsToQuoteState(areasToBaskets([area]));
    const it0 = items[0];
    expect(it0.quantity).toBe(5);
    expect(it0.length).toBeNull();
    expect(it0.unit_price).toBeCloseTo(115.61, 2);
    expect(it0.total_price).toBeCloseTo(578.05, 2);
    expect(it0.metadata).toMatchObject({ qty_unit: "metre", waste_percent: 10, supplier_length_m: 15.24, quote_category: "materials" });
    expect((it0.metadata as any).unit_cost).toBeCloseTo(57.8056, 3);
    expect(quoteLineDrift({ item_type: "Consumables", item_name: it0.item_name, quantity: 5, unit_price: 115.61, metadata: it0.metadata } as any, COPRL001)).toBeNull();
  });
  it("picker keeps One Stop Shop only; each items are not metre lines", () => {
    expect(isConsumable(COPRL001)).toBe(true);
    expect(isConsumable({ supplier_type: "ac_units" })).toBe(false);
    expect(isConsumable({ supplier_type: "installation_material" })).toBe(false);
    expect(isLengthCatalogItem(BRAC01)).toBe(false);
    const area = createEmptyArea("A");
    area.consumables.push({ id: "b", product: BRAC01, quantity: 2 });
    const { items } = basketsToQuoteState(areasToBaskets([area]));
    expect(items[0].quantity).toBe(2);
    expect((items[0].metadata as any).qty_unit).toBeUndefined();
  });
});
