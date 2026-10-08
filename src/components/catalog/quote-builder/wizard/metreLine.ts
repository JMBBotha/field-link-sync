/**
 * Visual PDF wizard: One Stop Shop length items become per-metre lines priced
 * by the SAME helper as the main builder (catalogLineFields -> lengthLinePrice,
 * active materials % + waste %), locked via stubProductFromQuoteItem exactly
 * like a re-opened waste-priced metre line. In the wizard such a line is a
 * "unit" material whose unitQuantity is metres (decimal, min 0.1).
 */
import type { PaletteProduct } from "../../QuoteBuilderTab";
import type { AreaMaterial } from "../quoteWizardTypes";
import { catalogLineFields } from "@/lib/mandy/quoteOps";
import { stubProductFromQuoteItem } from "@/utils/hydrateQuoteItem";

export const isConsumable = (p: { supplier_type?: string | null }) => p?.supplier_type === "consumables";

export const isLengthCatalogItem = (p: PaletteProduct) =>
  !!(p?.sold_in_length && Number(p?.unit_length) > 0) && (p as any).waste_percent == null;

/** Waste-priced metre stub (fresh pick or re-opened saved line). */
export const isMetreStub = (p: PaletteProduct) => (p as any)?.qty_unit === "metre" && (p as any)?.waste_percent != null;

export function metreStubProduct(p: PaletteProduct): PaletteProduct {
  const f = catalogLineFields(p, 1);
  return stubProductFromQuoteItem({
    id: p.id, product_id: p.id, item_number: f.item_number, item_name: f.item_name, item_type: p.product_category || p.category || "Consumables",
    description: f.description, unit_price: f.unit_price, quantity: 1, length: null, supplier: f.supplier, metadata: f.metadata,
  });
}

export const clampMetres = (v: number) => Math.max(0.1, Math.round((Number(v) || 0.1) * 10) / 10);

export function newMetreMaterial(p: PaletteProduct, metres = 1): AreaMaterial {
  return {
    id: crypto.randomUUID(), product: metreStubProduct(p), defaultLength: 1, adjustedLength: 1,
    costPerMeter: 0, totalCost: 0, pricingMode: "unit", unitQuantity: clampMetres(metres),
  };
}
