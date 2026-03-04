import type { BasketItem } from "@/components/catalog/QuoteBuilderTab";
import { getEffectiveUnitPrices } from "@/components/catalog/QuoteBuilderTab";

/** Shared basket subtotal calculation — single source of truth for zones */
export function calculateBasketSubtotal(items: BasketItem[]): number {
  return items.reduce((s, i) => {
    if (i.isBundle && i.bundleUnitPrice) {
      return s + (i.bundlePricingType === "p/meter"
        ? i.bundleUnitPrice * (i.length || 1)
        : i.bundleUnitPrice * i.quantity);
    }
    if (i.product.sold_in_length && i.product.price_per_metre && i.length) {
      return s + i.product.price_per_metre * i.length;
    }
    const { unitSell } = getEffectiveUnitPrices(i.product);
    return s + unitSell * i.quantity;
  }, 0);
}
