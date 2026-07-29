import type { BasketItem } from "@/components/catalog/QuoteBuilderTab";
import { getEffectiveUnitPrices } from "@/components/catalog/QuoteBuilderTab";
import { computeLineTotal, resolvePricingUnit } from "@/lib/pricingUnits";

/** Shared basket subtotal calculation — single source of truth for zones */
export function calculateBasketSubtotal(items: BasketItem[]): number {
  return items.reduce((s, i) => {
    if (i.isBundle && i.bundleUnitPrice) {
      return s + (i.bundlePricingType === "p/meter"
        ? i.bundleUnitPrice * (i.length || 1)
        : i.bundleUnitPrice * i.quantity);
    }
    const unit = resolvePricingUnit(i.product);
    if (i.product.sold_in_length && i.product.price_per_metre && i.length) {
      const { unitSell } = getEffectiveUnitPrices(i.product, true);
      return s + computeLineTotal(i.length, unitSell, unit);
    }
    const { unitSell } = getEffectiveUnitPrices(i.product);
    return s + computeLineTotal(i.quantity, unitSell, unit);
  }, 0);
}

