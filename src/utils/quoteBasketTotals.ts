import { computePricing, resolveSupplierCode, resolveProductMarkupPercent, lockedPricing } from "@/lib/pricing";
import type { Basket, BasketItem, PaletteProduct } from "@/components/catalog/QuoteBuilderTab";
import type { QuoteArea, QuoteItem } from "@/types/quote";
import { computeQuoteTotals } from "@/utils/quoteTransformers";
import { computeLineTotal, resolvePricingUnit } from "@/lib/pricingUnits";

import type { QuoteTotals } from "@/utils/quoteTransformers";

function getEffectiveUnitPrices(product: PaletteProduct, isLengthOverride?: boolean) {
  const isLength = isLengthOverride ?? (product.sold_in_length && !!product.price_per_metre);
  const packQty = product.pack_qty && product.pack_qty > 1 && !isLength ? product.pack_qty : 1;
  const listPrice = product.cost_excl_vat || 0;
  const markupPct = resolveProductMarkupPercent(product);
  const supplierCode = resolveSupplierCode(product.supplier_name);
  // Saved quote lines are price-locked: never re-apply markup (see PaletteProduct.locked_sell_ex_vat).
  const pricing = lockedPricing(product) ?? computePricing(supplierCode, listPrice, markupPct, product.cost_price || null);

  if (isLength) {
    const totalLength = product.unit_length || 1;
    return { unitSell: pricing.sellExVat / totalLength, unitCost: pricing.costExVat / totalLength };
  }

  return { unitSell: pricing.sellExVat / packQty, unitCost: pricing.costExVat / packQty };
}

export function calculateBasketItemSell(item: BasketItem): number {
  if (item.isBundle && item.bundleUnitPrice) {
    return item.bundlePricingType === "p/meter"
      ? item.bundleUnitPrice * (item.length || 1)
      : item.bundleUnitPrice * item.quantity;
  }
  const unit = resolvePricingUnit(item.product);
  if (item.product.sold_in_length && item.product.price_per_metre && item.length) {
    const { unitSell } = getEffectiveUnitPrices(item.product, true);
    return computeLineTotal(item.length, unitSell, unit);
  }
  const { unitSell } = getEffectiveUnitPrices(item.product);
  return computeLineTotal(item.quantity, unitSell, unit);
}


/** Ex-VAT cost for the whole line (mirrors calculateBasketItemSell). */
export function calculateBasketItemCost(item: BasketItem): number {
  if (item.isBundle && item.bundleUnitCost) {
    return item.bundlePricingType === "p/meter"
      ? item.bundleUnitCost * (item.length || 1)
      : item.bundleUnitCost * item.quantity;
  }
  const unit = resolvePricingUnit(item.product);
  if (item.product.sold_in_length && item.product.price_per_metre && item.length) {
    const { unitCost } = getEffectiveUnitPrices(item.product, true);
    return computeLineTotal(item.length, unitCost, unit);
  }
  const { unitCost } = getEffectiveUnitPrices(item.product);
  return computeLineTotal(item.quantity, unitCost, unit);
}

/**
 * TRUE markup of a line, derived from its real cost and sell:
 *   (sell − cost) / cost × 100
 * This is what the badge and project totals must show. The product's stored
 * markup field is only a fallback — for bundles/kits it belongs to the FIRST
 * component (not the kit), which is why a 100%-markup kit showed 25–35%.
 */
export function lineMarkupPercent(item: BasketItem): number {
  const sell = calculateBasketItemSell(item);
  const cost = calculateBasketItemCost(item);
  if (cost > 0 && sell > 0) return Math.round(((sell - cost) / cost) * 1000) / 10;
  return itemMarkupPercent(item);
}

function itemMarkupPercent(item: BasketItem): number {
  const explicit = Number(item.product.default_markup_percent ?? item.product.markup_percent ?? 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  if (item.bundleUnitCost && item.bundleUnitCost > 0 && item.bundleUnitPrice) {
    return ((item.bundleUnitPrice - item.bundleUnitCost) / item.bundleUnitCost) * 100;
  }
  return 0;
}

export function basketsToQuoteState(baskets: Basket[]): { areas: QuoteArea[]; items: QuoteItem[] } {
  const areas: QuoteArea[] = baskets.map((basket, index) => ({
    id: basket.id,
    quote_id: "live",
    name: basket.name,
    sort_order: index,
    created_at: "",
    updated_at: "",
  }));

  const items: QuoteItem[] = baskets.flatMap((basket, basketIndex) =>
    basket.items.map((item, itemIndex) => {
      const totalPrice = calculateBasketItemSell(item);
      const totalCost = calculateBasketItemCost(item);
      return {
        id: item.instanceId,
        quote_id: "live",
        area_id: basket.id,
        parent_item_id: null,
        product_id: item.product.id,
        item_name: item.bundleName || item.product.short_name || item.product.product_code || "Item",
        item_number: item.product.product_code || null,
        description: item.product.description || null,
        quantity: item.quantity,
        length: item.length ?? null,
        unit_price: item.quantity > 0 ? totalPrice / item.quantity : totalPrice,
        total_price: totalPrice,
        is_bundle: !!item.isBundle,
        item_type: item.product.product_category || item.product.category || null,
        // unit_cost is persisted so a re-opened (price-locked) line keeps its
        // real margin; unit_price above is the FINAL sell and is never re-marked-up.
        metadata: {
          markup_percent: lineMarkupPercent(item),
          total_cost: totalCost,
          unit_cost: item.quantity > 0 ? totalCost / item.quantity : totalCost,
          cost_excl: item.quantity > 0 ? totalCost / item.quantity : totalCost, // compat alias
          price_locked: true,
          ...(item.isBundle && item.bundlePricingType
            ? {
                kit: {
                  bundle_id: item.bundleId ?? null,
                  name: item.bundleName || item.product.short_name || "Kit",
                  pricing_type: item.bundlePricingType,
                  unit_cost: item.bundleUnitCost ?? 0,
                  items: item.kitContents ?? (item.bundleItems || []).map((b) => ({
                    name: b.product.short_name || b.product.product_code || "Item",
                    code: b.product.product_code || null,
                    quantity: b.quantity,
                    isLengthItem: b.isLengthItem,
                  })),
                },
              }
            : {}),
        },
        sort_order: basketIndex * 1000 + itemIndex,
        notes: null,
        source: "builder_live",
        supplier: item.product.supplier_name || null,
        created_at: "",
        updated_at: "",
      } satisfies QuoteItem;
    })
  );

  return { areas, items };
}

export function computeBasketsQuoteTotals(baskets: Basket[]): QuoteTotals {
  const { items, areas } = basketsToQuoteState(baskets);
  return computeQuoteTotals(items, areas);
}