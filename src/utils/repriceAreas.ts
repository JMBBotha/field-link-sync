/**
 * Reprice Area Quote Builder lines when the quote's Units % / Materials %
 * change. Same rules as applyCategoryRatesToBaskets:
 *  - manually edited lines keep their price
 *  - kits: sell/unit = kit cost × (1 + materials%)
 *  - saved (price-locked) lines: sell = saved cost × (1 + category%)
 *  - live catalogue lines follow the active rates automatically
 *  - labour is never marked up
 */
import { categoryMarkupPercent, r2, type CategoryMarkupRates } from "@/lib/pricing";
import type { QuoteArea, AreaMaterial } from "@/components/catalog/quote-builder/quoteWizardTypes";
import { repriceProductForRates } from "@/utils/quoteBasketTotals";
import { withKitLength } from "@/components/catalog/quote-builder/kitLine";

function repriceMaterial(m: AreaMaterial, rates: CategoryMarkupRates): AreaMaterial {
  if (m.product.manual_price_override) return m;
  if (m.kit) {
    if (!(m.kit.unitCost > 0)) return m;
    const unitSell = r2(m.kit.unitCost * (1 + categoryMarkupPercent("materials", rates) / 100));
    const next: AreaMaterial = {
      ...m,
      kit: { ...m.kit, unitSell },
      costPerMeter: unitSell,
      product: { ...m.product, locked_sell_ex_vat: unitSell, selling_price: unitSell, price_per_metre: m.pricingMode === "length" ? unitSell : m.product.price_per_metre },
    };
    return withKitLength(next, m.pricingMode === "length" ? m.adjustedLength : m.unitQuantity);
  }
  const product = repriceProductForRates(m.product, rates);
  const lockedSell = Number(product.locked_sell_ex_vat);
  if (m.pricingMode === "length" && Number.isFinite(lockedSell) && product.locked_sell_ex_vat != null) {
    const len = Number(product.unit_length) || m.adjustedLength || 1;
    const perM = lockedSell / len;
    return { ...m, product, costPerMeter: perM, totalCost: perM * m.adjustedLength };
  }
  return { ...m, product };
}

export function applyCategoryRatesToAreas(areas: QuoteArea[], rates: CategoryMarkupRates): QuoteArea[] {
  return areas.map((a) => ({
    ...a,
    acUnits: a.acUnits.map((u) => ({ ...u, product: repriceProductForRates(u.product, rates) })),
    consumables: a.consumables.map((c) => ({ ...c, product: repriceProductForRates(c.product, rates) })),
    materials: a.materials.map((m) => repriceMaterial(m, rates)),
  }));
}
