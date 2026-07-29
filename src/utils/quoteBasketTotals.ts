import { computePricing, resolveSupplierCode } from "@/lib/pricing";
import type { Basket, BasketItem, PaletteProduct } from "@/components/catalog/QuoteBuilderTab";
import type { QuoteArea, QuoteItem } from "@/types/quote";
import { computeQuoteTotals } from "@/utils/quoteTransformers";
import { computeLineTotal, resolvePricingUnit } from "@/lib/pricingUnits";

import type { QuoteTotals } from "@/utils/quoteTransformers";

function getEffectiveUnitPrices(product: PaletteProduct, isLengthOverride?: boolean) {
  const isLength = isLengthOverride ?? (product.sold_in_length && !!product.price_per_metre);
  const packQty = product.pack_qty && product.pack_qty > 1 && !isLength ? product.pack_qty : 1;
  const listPrice = product.cost_excl_vat || 0;
  const markupPct = product.default_markup_percent ?? product.markup_percent ?? 35;
  const supplierCode = resolveSupplierCode(product.supplier_name);
  const pricing = computePricing(supplierCode, listPrice, markupPct, product.cost_price || null);

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
        metadata: { markup_percent: itemMarkupPercent(item) },
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