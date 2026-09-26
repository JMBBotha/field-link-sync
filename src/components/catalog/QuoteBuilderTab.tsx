import { useState, useCallback, useMemo, useRef, useEffect, useSyncExternalStore } from "react";
import { inclVatFromExcl, computePricing, resolveSupplierCode, resolveProductMarkupPercent, lockedPricing } from "@/lib/pricing";
import { extractBtu } from "@/lib/bundles";
import { planStandardInstall, installBasketItem } from "@/lib/mandy/quoteOps";
import { useInstallTemplates } from "@/hooks/useInstallTemplates";
import type { BasketInstall } from "@/lib/installTemplates";
import type { PdfSelectionHandlers } from "@/types/pdfSelection";
import { Search, ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  closestCenter,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type CollisionDetection,
  rectIntersection,
} from "@dnd-kit/core";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import ProductPalette from "./quote-builder/ProductPalette";
import type { PaletteBundle } from "./quote-builder/ProductPalette";
import VisualCatalogPanel from "./quote-builder/VisualCatalogPanel";
import BasketCanvas from "./quote-builder/BasketCanvas";
import DragOverlayCard from "./quote-builder/DragOverlayCard";
import FloatingDropZoneStrip from "./quote-builder/FloatingDropZoneStrip";
import ACOptionsModal, { detectACType } from "./quote-builder/ACOptionsModal";
import QuoteSummaryPanel from "./quote-builder/QuoteSummaryPanel";
import { toast } from "@/hooks/use-toast";
// favorites now derived from is_pinned on product data
import { useProductUsageStats } from "@/hooks/useProductUsageStats";
import { searchAndRankProducts } from "./searchSynonyms";
import QuoteBuilderPopup from "./quote-builder/QuoteBuilderPopup";
import type { WizardTriggerItem } from "./quote-builder/QuoteBuilderPopup";
import { computeBundlePricing } from "./quote-builder/BundleItemsPopover";
import { computeBasketsQuoteTotals, applyCategoryRatesToBaskets } from "@/utils/quoteBasketTotals";
import { subscribeQuoteMarkupRates, getQuoteMarkupRatesSnapshot } from "@/lib/pricing";
import type { QuoteTotals } from "@/utils/quoteTransformers";

type QuoteBuilderBundle = PaletteBundle & {
  min_btu?: number | null;
  max_btu?: number | null;
};

export interface PaletteProduct {
  id: string;
  product_code: string;
  short_name: string;
  brand: string;
  product_category: string;
  category: string;
  cost_excl_vat: number;
  cost_incl_vat: number;
  cost_price: number;
  selling_price: number;
  default_markup_percent: number;
  description: string;
  is_pinned: boolean;
  pin_order: number | null;
  supplier_name: string;
  supplier_type: string;
  price_per_metre: number | null;
  sold_in_length: boolean;
  unit_length: number | null;
  pipe_size: string | null;
  is_material_favorite: boolean;
  pack_qty: number | null;
  btu_rating?: number | null;
  /** @deprecated use default_markup_percent */
  supplier_discount_percent: number | null;
  /** @deprecated use default_markup_percent */
  markup_percent: number | null;
  unit_type?: string | null;
  price_per_unit_qty?: number | null;
  price_per_unit_label?: string | null;
  allows_decimal_qty?: boolean | null;
  qty_step?: number | null;
  min_qty?: number | null;
  search_aliases?: string[] | null;
  /**
   * PRICE LOCK — set when a line is re-hydrated from a saved quote_item.
   * The stored unit_price is ALREADY the final selling price (markup applied
   * once, when the line was first added). When present, every pricing helper
   * must return this value verbatim and never apply markup again. Without
   * this, reopening a quote re-marked-up every line (x1.25 on Samsung, x1.35
   * on 0-markup rows) and auto-save wrote the inflated price back — so the
   * total grew every time the Quote Builder was opened.
   */
  locked_sell_ex_vat?: number | null;
  /** Cost that goes with locked_sell_ex_vat (for margin display only). */
  locked_cost_ex_vat?: number | null;
  /** Staff typed this line's sell/markup by hand — quote Units/Materials % must never overwrite it. */
  manual_price_override?: boolean;
}

/** Returns the effective per-unit prices for a product, using computePricing
 *  to ensure supplier discounts (e.g. Samsung 20%) are always applied.
 */
export function getEffectiveUnitPrices(product: PaletteProduct, isLengthOverride?: boolean) {
  const isLength = isLengthOverride ?? (product.sold_in_length && !!product.price_per_metre);
  const pq = product.pack_qty && product.pack_qty > 1 && !isLength ? product.pack_qty : 1;

  const listPrice = product.cost_excl_vat || 0;
  const markupPct = resolveProductMarkupPercent(product);
  const supplierCode = resolveSupplierCode(product.supplier_name);

  // computePricing handles discount + markup; cost_price may already be discounted
  // Saved quote lines are price-locked: never re-apply markup (see PaletteProduct.locked_sell_ex_vat).
  const pricing = lockedPricing(product) ?? computePricing(supplierCode, listPrice, markupPct, product.cost_price || null);

  let unitSell: number;
  let unitCost: number;

  if (isLength) {
    // For length items, derive per-metre from total
    const totalLength = product.unit_length || 1;
    unitCost = pricing.costExVat / totalLength;
    unitSell = pricing.sellExVat / totalLength;
  } else {
    unitSell = pricing.sellExVat / pq;
    unitCost = pricing.costExVat / pq;
  }

  return { unitCost, unitSell, isPackItem: pq > 1, packQty: pq };
}

export interface BasketItem {
  instanceId: string;
  product: PaletteProduct;
  quantity: number;
  length?: number;
  /** If this item represents a collapsed bundle */
  isBundle?: boolean;
  bundleId?: string;
  bundleName?: string;
  /** Marker for auto-added 3-tier bundle rows */
  tier_bundle?: boolean;
  tier_name?: "T1" | "T2" | "T3";
  bundleItems?: Array<{
    product: PaletteProduct;
    quantity: number;
    length?: number;
    isLengthItem: boolean;
    isOptional?: boolean;
  }>;
  bundlePricingType?: "p/meter" | "p/qty";
  bundleUnitPrice?: number;
  bundleUnitCost?: number;
  /** Contents of a collapsed installation kit (display only). */
  kitContents?: Array<{ name: string; code: string | null; quantity: number; isLengthItem: boolean }>;
  /** Standard-install link to the unit line (unitKey = unit's instanceId). */
  install?: BasketInstall;
}

export interface Basket {
  id: string;
  name: string;
  items: BasketItem[];
}

// Custom shouldHandleEvent to skip data-no-dnd elements
class NoDndPointerSensor extends PointerSensor {
  static activators = [
  {
    eventName: "onPointerDown" as const,
    handler: ({ nativeEvent }: {nativeEvent: PointerEvent;}) => {
      const target = nativeEvent.target as HTMLElement | null;
      if (target?.closest?.('[data-no-dnd="true"]')) {
        return false;
      }
      return true;
    }
  }];

}


interface QuoteBuilderTabProps {
  onBasketsChange?: (baskets: Basket[]) => void;
  pdfSelection?: PdfSelectionHandlers;
  onPopOutSelected?: () => void;
  /** Optional inline widget rendered between header and zone cards */
  areaBuilderNode?: React.ReactNode;
  /** Area builder action refs for header buttons */
  areaAddZone?: () => void;
  areaApplyTemplate?: (zones: string[]) => void;
  areaClearAll?: () => void;
  areaCount?: number;
  /** Ref-based handler to drop a product into a specific wizard area */
  areaDropProductToArea?: (areaId: string, product: PaletteProduct) => void;
  /** Ref-based handler to drop a bundle into a specific wizard area */
  areaDropBundleToArea?: (areaId: string, bundle: any) => void;
  /** Baskets seeded from an existing quote — hydrates body state so it matches
   *  the header summary (fixes split-brain where body showed 0 items). */
  initialBaskets?: Basket[] | null;
  /** Extra baskets from the inline Area/Wizard builder — merged into the
   *  Quote Total bar so every displayed total (header, bar, sidebar) reads
   *  the same combined set. Not added to `baskets` state. */
  extraBaskets?: Basket[];
  quoteTotals?: QuoteTotals;
}

const QuoteBuilderTab = ({ onBasketsChange, pdfSelection, onPopOutSelected, areaBuilderNode, areaAddZone, areaApplyTemplate, areaClearAll, areaCount, areaDropProductToArea, areaDropBundleToArea, initialBaskets, extraBaskets, quoteTotals: providedQuoteTotals }: QuoteBuilderTabProps = {}) => {
  const [baskets, setBasketsInternal] = useState<Basket[]>(() =>
    initialBaskets != null
      ? initialBaskets
      : [{ id: "basket-1", name: "Zone 1", items: [] }]
  );

  const setBaskets: typeof setBasketsInternal = useCallback((action) => {
    setBasketsInternal((prev) => {
      const next = typeof action === "function" ? action(prev) : action;
      onBasketsChange?.(next);
      return next;
    });
  }, [onBasketsChange]);
  // Notify parent of initial baskets on mount
  useEffect(() => {
    onBasketsChange?.(baskets);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Hydrate from parent-provided baskets exactly once when they arrive
  // (e.g. after the quote finishes loading from the DB).
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    if (initialBaskets == null) return;
    hydratedRef.current = true;
    setBasketsInternal(initialBaskets);
    onBasketsChange?.(initialBaskets);
  }, [initialBaskets, onBasketsChange]);

  // When the user edits the quote's Units % / Materials %, reprice every line
  // of that category (saved lines included). Loading never triggers this.
  const rateSnap = useSyncExternalStore(subscribeQuoteMarkupRates, getQuoteMarkupRatesSnapshot);
  const lastEditSeqRef = useRef(rateSnap.editSeq);
  useEffect(() => {
    if (rateSnap.editSeq === lastEditSeqRef.current) return;
    lastEditSeqRef.current = rateSnap.editSeq;
    if (rateSnap.rates) {
      const rates = rateSnap.rates;
      setBaskets((prev) => applyCategoryRatesToBaskets(prev, rates));
    }
  }, [rateSnap, setBaskets]);

  const [activeProduct, setActiveProduct] = useState<PaletteProduct | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [acModalOpen, setAcModalOpen] = useState(false);
  const [acModalProduct, setAcModalProduct] = useState<PaletteProduct | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [visualPanelOpen, setVisualPanelOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardTriggerItem, setWizardTriggerItem] = useState<WizardTriggerItem | null>(null);
  const [wizardPreviewBaskets, setWizardPreviewBaskets] = useState<Basket[]>([]);
  const queryClient = useQueryClient();
  const { usageMap, trackUsage } = useProductUsageStats();
  const canvasRef = useRef<HTMLDivElement>(null);
  const addBundleToBasketRef = useRef<((basketId: string, bundle: any) => void) | null>(null);
  const isMobile = useIsMobile();

  const scrollToCanvas = useCallback(() => {
    if (isMobile && canvasRef.current) {
      setTimeout(() => {
        canvasRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 150);
    }
  }, [isMobile]);

  // Fetch products
  const { data: products = [], isLoading } = useQuery({
    queryKey: ["quote-builder-products"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_products") as any).
      select("id, product_code, short_name, brand, product_category, category, cost_price, cost_excl_vat, selling_price, description, is_pinned, pin_order, price_per_metre, sold_in_length, unit_length, pipe_size, is_material_favorite, suggested_consumables, pack_qty, default_markup_percent, btu_rating, unit_type, price_per_unit_qty, price_per_unit_label, allows_decimal_qty, qty_step, min_qty, search_aliases, suppliers(name, supplier_type)").
      or("archived.is.null,archived.eq.false").
      eq("is_active", true).
      order("is_pinned", { ascending: false }).
      order("pin_order", { ascending: true, nullsFirst: false }).
      limit(2000);

      if (error) throw error;
      return (data || []).map((p: any) => ({
        ...p,
        product_category: p.product_category || p.category || "",
        supplier_name: p.suppliers?.name || "",
        supplier_type: p.suppliers?.supplier_type || "both",
        price_per_metre: p.price_per_metre || null,
        sold_in_length: p.sold_in_length || false,
        unit_length: p.unit_length || null,
        pipe_size: p.pipe_size || null,
        is_material_favorite: p.is_material_favorite || false,
        pack_qty: p.pack_qty || null,
        btu_rating: p.btu_rating || null,
        supplier_discount_percent: null,
        markup_percent: resolveProductMarkupPercent(p as any),
        default_markup_percent: resolveProductMarkupPercent(p as any),
        cost_price: p.cost_price ?? p.cost_excl_vat ?? 0,
      })) as PaletteProduct[];
    },
    staleTime: 60000
  });

  const favorites = useMemo(() => new Set(products.filter((p) => p.is_pinned).map((p) => p.id)), [products]);
  const togglePinMutation = useMutation({
    mutationFn: async (productId: string) => {
      const currentlyPinned = products.find((p) => p.id === productId)?.is_pinned ?? false;
      const pinOrder = currentlyPinned ? 0 : Math.floor(Date.now() / 1000) % 2000000000;
      const { error } = await (supabase.from("supplier_products") as any).
      update({ is_pinned: !currentlyPinned, pin_order: pinOrder } as any).eq("id", productId);
      if (error) throw error;
    },
    onMutate: async (productId) => {
      await queryClient.cancelQueries({ queryKey: ["quote-builder-products"] });
      queryClient.setQueryData<PaletteProduct[]>(["quote-builder-products"], (old) =>
      old?.map((p) => p.id === productId ? { ...p, is_pinned: !p.is_pinned } : p)
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["quote-builder-products"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-products-all"] });
    }
  });
  const toggleFavorite = useCallback((id: string) => togglePinMutation.mutate(id), [togglePinMutation]);

  // Fetch bundles with their items + products
  const { data: bundles = [], isLoading: bundlesLoading } = useQuery<QuoteBuilderBundle[]>({
    queryKey: ["quote-builder-bundles"],
    queryFn: async () => {
      const { data: bundleData, error: bErr } = await supabase.
      from("installation_bundles").
      select("id, name, description, bundle_type, min_btu, max_btu, compatible_brands, is_favorite").
      eq("is_active", true).
      order("name");
      if (bErr) throw bErr;
      if (!bundleData || bundleData.length === 0) return [];

      const { data: itemsData, error: iErr } = await (supabase.from("bundle_items") as any).
      select("id, bundle_id, supplier_product_id, quantity, length_metres, is_length_item, is_optional, sort_order, supplier_products(id, product_code, short_name, brand, product_category, category, cost_excl_vat, cost_incl_vat, cost_price, default_markup_percent, supplier_discount_percent, markup_percent, selling_price, description, is_pinned, pin_order, price_per_metre, sold_in_length, unit_length, unit_type, price_per_unit_qty, price_per_unit_label, allows_decimal_qty, qty_step, min_qty, suppliers(name))").
      order("sort_order");
      if (iErr) throw iErr;

      const itemsByBundle: Record<string, any[]> = {};
      (itemsData || []).forEach((item: any) => {
        if (!itemsByBundle[item.bundle_id]) itemsByBundle[item.bundle_id] = [];
        const sp = item.supplier_products;
        itemsByBundle[item.bundle_id].push({
          id: item.id,
          supplier_product_id: item.supplier_product_id,
          quantity: item.quantity,
          length_metres: item.length_metres,
          is_length_item: item.is_length_item,
          is_optional: item.is_optional || false,
          product: sp ? {
            ...sp,
            product_category: sp.product_category || sp.category || "",
            supplier_name: sp.suppliers?.name || "",
            price_per_metre: sp.price_per_metre || null,
            sold_in_length: sp.sold_in_length || false,
            unit_length: sp.unit_length || null,
            cost_price: sp.cost_price ?? 0,
            default_markup_percent: resolveProductMarkupPercent(sp as any),
            supplier_discount_percent: sp.supplier_discount_percent ?? null,
            markup_percent: sp.markup_percent ?? null,
            unit_type: sp.unit_type || null,
            price_per_unit_qty: sp.price_per_unit_qty ?? 1,
            price_per_unit_label: sp.price_per_unit_label || "each",
            allows_decimal_qty: sp.allows_decimal_qty ?? false,
            qty_step: sp.qty_step ?? 1,
            min_qty: sp.min_qty ?? 1
          } : null
        });
      });

      return bundleData.map((b) => ({
        ...b,
        items: itemsByBundle[b.id] || []
      }));
    },
    staleTime: 60000
  });

  // Brand & Type Inference
  const inferredBrand = useMemo(() => {
    for (const basket of baskets) {
      for (const item of basket.items) {
        if (item.product.product_category === "Air Conditioning" && item.product.brand) {
          return item.product.brand;
        }
      }
    }
    return null;
  }, [baskets]);

  const inferredType = useMemo(() => {
    for (const basket of baskets) {
      for (const item of basket.items) {
        if (item.product.product_category === "Air Conditioning") {
          const t = detectACType(item.product);
          if (t) return t;
        }
      }
    }
    return null;
  }, [baskets]);

  // Client-side filtering — multi-word search across all fields, ignoring category during search
  const filteredProducts = useMemo(() => {
    let result = products;

    // Only filter by category when NOT searching
    if (!debouncedSearch.trim() && categoryFilter !== "all" && categoryFilter !== "favorites") {
      result = result.filter((p) =>
      p.product_category === categoryFilter ||
      (p.category || "").toLowerCase().includes(categoryFilter.toLowerCase())
      );
    }

    if (debouncedSearch.trim()) {
      // Alias-aware, ranked: exact code / alias phrase first, then fuzzy token hits.
      result = searchAndRankProducts(debouncedSearch, result);
    }

    return result;
  }, [products, categoryFilter, debouncedSearch]);

  const sensors = useSensors(
    useSensor(NoDndPointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const isAirConditioningProduct = useCallback((product: PaletteProduct) => {
    const blob = [product.product_category, product.category, product.short_name, product.description]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return blob.includes("air conditioning") || blob.includes("aircon");
  }, []);

  const { templates: installTemplates } = useInstallTemplates();
  /** Shared standard-install rule (same resolver as the estimate page and Mandy). */
  const planInstall = useCallback((product: PaletteProduct) =>
    planStandardInstall(product, installTemplates, bundles as any, products as PaletteProduct[]),
  [installTemplates, bundles, products]);

  const buildBundleBasketItem = useCallback((bundle: PaletteBundle): BasketItem | null => {
    const subItems = bundle.items
      .filter((bItem) => bItem.product)
      .map((bItem) => {
        const isLengthItem = bItem.is_length_item && !!bItem.product!.price_per_metre;
        return {
          product: bItem.product as PaletteProduct,
          quantity: bItem.quantity,
          isLengthItem,
          isOptional: bItem.is_optional,
          ...(isLengthItem ? { length: bItem.length_metres || 1 } : {}),
        };
      });

    const { pricingType, unitPrice, unitCost } = computeBundlePricing(subItems);
    const firstProduct = subItems.find((i) => !i.isOptional)?.product || subItems[0]?.product;
    if (!firstProduct) return null;

    // Synthetic bundle product: every cost field holds COST (per metre for
    // p/meter kits); the package SELL rate lives only on bundleUnitPrice.
    const bundleMarkup = unitCost > 0 ? ((unitPrice - unitCost) / unitCost) * 100 : 0;
    return {
      instanceId: `bundle-${bundle.id}-${Date.now()}`,
      product: {
        ...firstProduct,
        short_name: bundle.name,
        description: `Bundle: ${bundle.name} (${subItems.length} items)`,
        product_code: `BUNDLE-${bundle.id.slice(0, 6).toUpperCase()}`,
        product_category: firstProduct.product_category,
        selling_price: unitPrice,
        cost_price: unitCost,
        cost_excl_vat: unitCost,
        cost_incl_vat: inclVatFromExcl(unitCost),
        default_markup_percent: bundleMarkup,
        markup_percent: bundleMarkup,
        pack_qty: null,
        sold_in_length: pricingType === "p/meter",
        unit_length: pricingType === "p/meter" ? 1 : null,
        price_per_metre: pricingType === "p/meter" ? unitCost : null,
      },
      quantity: 1,
      ...(pricingType === "p/meter" ? { length: 1 } : {}),
      isBundle: true,
      bundleId: bundle.id,
      bundleName: bundle.name,
      bundleItems: subItems,
      bundlePricingType: pricingType,
      bundleUnitPrice: unitPrice,
      bundleUnitCost: unitCost,
    };
  }, []);

  const addProductToBasket = useCallback((basketId: string, product: PaletteProduct, source: string = "unknown") => {
    trackUsage(product.id);

    const isLengthItem = product.sold_in_length && !!product.price_per_metre;
    const isAC = isAirConditioningProduct(product);
    const plan = isAC ? planInstall(product) : null;
    const autoBundle = (plan?.kitBundle as QuoteBuilderBundle | null) ?? null;

    if (autoBundle) {
      autoBundle.items.forEach((item) => {
        if (item.product?.id) trackUsage(item.product.id);
      });
    }

    setBaskets((prev) =>
      prev.map((basket) => {
        if (basket.id !== basketId) return basket;

        const nextItems = [...basket.items];

        // A unit with a standard install is always its own line (its install hangs off it).
        const unitKey = `${product.id}-${Date.now()}`;
        const existingProductIndex = plan ? -1 : nextItems.findIndex((i) => !i.isBundle && i.product.id === product.id);
        if (existingProductIndex >= 0) {
          const existing = nextItems[existingProductIndex];
          nextItems[existingProductIndex] = isLengthItem
            ? { ...existing, length: (existing.length || 1) + 1 }
            : { ...existing, quantity: existing.quantity + 1 };
        } else {
          nextItems.push({
            instanceId: unitKey,
            product,
            quantity: 1,
            // Metre items start at 1 m (user-entered run) — never the full coil length.
            ...(isLengthItem ? { length: 1 } : {}),
          });
        }

        if (autoBundle) {
          const existingBundleIndex = plan?.template ? -1 : nextItems.findIndex((i) => i.isBundle && i.bundleId === autoBundle.id);

          if (existingBundleIndex >= 0) {
            const existingBundle = nextItems[existingBundleIndex];
            nextItems[existingBundleIndex] = existingBundle.bundlePricingType === "p/meter"
              ? { ...existingBundle, length: (existingBundle.length || 1) + 1 }
              : { ...existingBundle, quantity: existingBundle.quantity + 1 };
          } else {
            const bundleBasketItem = buildBundleBasketItem(autoBundle);
            if (bundleBasketItem) {
              const kitItem = bundleBasketItem.bundlePricingType === "p/meter" ? { ...bundleBasketItem, length: plan!.kitLength } : bundleBasketItem;
              nextItems.push(plan?.template ? { ...kitItem, instanceId: `${unitKey}-kit`, install: { unitKey, role: "piping_kit", template_id: plan.template.id } } : kitItem);
            }
          }
        }

        // Standard install lines: each its own line, priced per supplier length (never per metre).
        for (const l of plan?.lines || []) nextItems.push(installBasketItem(l, unitKey, plan!.template?.id ?? null));

        return { ...basket, items: nextItems };
      })
    );

    if (plan?.notes.length) toast({ title: "Standard install", description: plan.notes.join(". ") });
    scrollToCanvas();
  }, [trackUsage, scrollToCanvas, isAirConditioningProduct, planInstall, buildBundleBasketItem, bundles]);

  const addBundleToBasket = useCallback((basketId: string, bundle: PaletteBundle) => {
    bundle.items.forEach((item) => {
      if (item.product?.id) trackUsage(item.product.id);
    });

    const bundleItem = buildBundleBasketItem(bundle);
    if (!bundleItem) return;

    setBaskets((prev) =>
    prev.map((basket) => {
      if (basket.id !== basketId) return basket;
      return { ...basket, items: [...basket.items, bundleItem] };
    })
    );
    scrollToCanvas();
  }, [trackUsage, scrollToCanvas, buildBundleBasketItem]);
  // Keep ref in sync

  addBundleToBasketRef.current = addBundleToBasket;

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const product = (event.active.data.current as any)?.product as PaletteProduct | undefined;
    if (product) setActiveProduct(product);
    setIsDragging(true);
  }, []);

  const handleDragCancel = useCallback(() => {
    setActiveProduct(null);
    setIsDragging(false);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveProduct(null);
    setIsDragging(false);
    const { active, over } = event;

    if (!over) return;

    const overId = String(over.id);

    // Check if dropped on a wizard area target
    if (overId.startsWith("wizard-area-")) {
      const areaId = overId.replace("wizard-area-", "");

      // Handle bundle drop on wizard area
      const bundleData = (active.data.current as any)?.bundle;
      if (bundleData && areaDropBundleToArea) {
        areaDropBundleToArea(areaId, bundleData);
        toast({ title: `Added bundle "${bundleData.name}" to area` });
        return;
      }

      // Handle product drop on wizard area
      const product = (active.data.current as any)?.product as PaletteProduct | undefined;
      if (product && areaDropProductToArea) {
        areaDropProductToArea(areaId, product);
        toast({ title: `Added ${product.short_name || product.product_code} to area` });
      }
      return;
    }

    let targetBasket: Basket | null = null;
    for (const basket of baskets) {
      if (basket.id === overId) {
        targetBasket = basket;
        break;
      }
    }
    if (!targetBasket) return;

    // Check if it's a bundle drop
    const bundleData = (active.data.current as any)?.bundle;
    if (bundleData) {
      addBundleToBasket(targetBasket.id, bundleData);
      toast({ title: `Added bundle "${bundleData.name}" to ${targetBasket.name}` });
      return;
    }

    const product = (active.data.current as any)?.product as PaletteProduct | undefined;
    if (!product) return;
    addProductToBasket(targetBasket.id, product, "drag-drop");
    const displayName = product.short_name || product.product_code;
    toast({ title: `Added ${displayName} to ${targetBasket.name}` });
  }, [baskets, addProductToBasket, addBundleToBasket, areaDropProductToArea, areaDropBundleToArea]);

  const handleRemoveItem = useCallback((basketId: string, instanceId: string) => {
    setBaskets((prev) =>
    prev.map((b) =>
    b.id === basketId ?
    { ...b, items: b.items.filter((i) => i.instanceId !== instanceId) } :
    b
    )
    );
  }, []);

  const handleUpdateQuantity = useCallback((basketId: string, instanceId: string, qty: number) => {
    if (qty < 1) return;
    setBaskets((prev) =>
    prev.map((b) =>
    b.id === basketId ?
    {
      ...b,
      items: b.items.map((i) => {
        if (i.instanceId !== instanceId) return i;
        // Scale bundle sub-items proportionally for p/qty bundles
        if (i.isBundle && i.bundleItems && i.bundlePricingType === "p/qty") {
          const oldQty = i.quantity;
          const ratio = qty / oldQty;
          const scaledBundleItems = i.bundleItems.map((si) => ({
            ...si,
            quantity: si.isLengthItem ? si.quantity : Math.max(1, Math.round(si.quantity * ratio)),
            length: si.isLengthItem ? (si.length || 1) * ratio : si.length
          }));
          return { ...i, quantity: qty, bundleItems: scaledBundleItems };
        }
        return { ...i, quantity: qty };
      })
    } :
    b
    )
    );
  }, []);

  const handleUpdateLength = useCallback((basketId: string, instanceId: string, length: number) => {
    if (length < 0.1) return;
    setBaskets((prev) =>
    prev.map((b) =>
    b.id === basketId ?
    {
      ...b,
      items: b.items.map((i) => {
        if (i.instanceId !== instanceId) return i;
        // Scale bundle sub-items proportionally for p/meter bundles
        if (i.isBundle && i.bundleItems && i.bundlePricingType === "p/meter") {
          const oldLength = i.length || 1;
          const ratio = length / oldLength;
          const scaledBundleItems = i.bundleItems.map((si) => ({
            ...si,
            length: si.isLengthItem ? (si.length || 1) * ratio : si.length
          }));
          return { ...i, length, bundleItems: scaledBundleItems };
        }
        return { ...i, length };
      })
    } :
    b
    )
    );
  }, []);

  const handleAddBasket = useCallback(() => {
    const id = `basket-${Date.now()}`;
    setBaskets((prev) => [...prev, { id, name: `Zone ${prev.length + 1}`, items: [] }]);
  }, []);

  const handleRenameBasket = useCallback((basketId: string, newName: string) => {
    setBaskets((prev) =>
    prev.map((b) => b.id === basketId ? { ...b, name: newName } : b)
    );
  }, []);

  const handleRemoveBasket = useCallback((basketId: string) => {
    setBaskets((prev) => prev.filter((b) => b.id !== basketId));
  }, []);

  const handleDuplicateBasket = useCallback((basketId: string) => {
    setBaskets((prev) => {
      const source = prev.find((b) => b.id === basketId);
      if (!source) return prev;
      const newId = `basket-${Date.now()}`;
      const duplicate: Basket = {
        id: newId,
        name: `${source.name} (copy)`,
        items: source.items.map((i) => ({
          ...i,
          instanceId: `${i.product.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        }))
      };
      const idx = prev.indexOf(source);
      const next = [...prev];
      next.splice(idx + 1, 0, duplicate);
      return next;
    });
  }, []);

  const handleApplyTemplate = useCallback((zoneNames: string[]) => {
    const newBaskets = zoneNames.map((name, i) => ({
      id: `basket-${Date.now()}-${i}`,
      name,
      items: [] as BasketItem[]
    }));
    setBaskets(newBaskets);
  }, []);

  const handleACConfirm = useCallback((product: PaletteProduct) => {
    const targetBasket = baskets[0];
    if (targetBasket) {
      addProductToBasket(targetBasket.id, product, "ac-modal-confirm");
    }
  }, [baskets, addProductToBasket]);

  /** Baskets used for header + sidebar totals. While the wizard is open, we
   *  merge its in-progress preview baskets so totals update live on every
   *  selection/quantity change — matching what the user is building on screen. */
  const displayBaskets = useMemo(
    () => {
      const extras = extraBaskets ?? [];
      if (wizardOpen) return [...baskets, ...wizardPreviewBaskets, ...extras];
      return [...baskets, ...extras];
    },
    [baskets, wizardPreviewBaskets, wizardOpen, extraBaskets]
  );


  const computedQuoteTotals = useMemo(() => computeBasketsQuoteTotals(displayBaskets), [displayBaskets]);
  const quoteTotals = providedQuoteTotals ?? computedQuoteTotals;

  const handleClearAll = useCallback(() => {
    setBaskets([]);
  }, []);

  const handleWizardSave = useCallback((newBaskets: Basket[]) => {
    setBaskets((prev) => [...prev, ...newBaskets]);
    setWizardPreviewBaskets([]);
    toast({ title: `Added ${newBaskets.length} zones from Area Quote Builder` });
  }, []);

  const handleOpenWizardFromPdf = useCallback((item: WizardTriggerItem) => {
    setWizardTriggerItem(item);
    setVisualPanelOpen(false); // Close Visual Catalog
    setWizardOpen(true);
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden gap-3 relative pb-2 min-w-0">
      <div className="hidden md:flex flex-col border bg-card p-3 z-10 shadow-sm shrink-0 rounded-sm py-[6px] mx-[4px] my-[8px] gap-[6px]">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">
            Quote Total ({quoteTotals.itemCount} items across {quoteTotals.zoneCount} zones)
          </span>
          <span className="text-lg font-bold text-foreground">
            R {quoteTotals.subtotal.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}>

      <div className="grid grid-cols-1 grid-rows-[minmax(0,2fr)_minmax(0,3fr)] md:grid-rows-1 md:grid-cols-5 gap-4 flex-1 min-h-0 overflow-hidden px-2">
          <div className="md:col-span-2 flex flex-col min-h-0 overflow-hidden pl-2">
            <ProductPalette
              products={filteredProducts}
              isLoading={isLoading}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              categoryFilter={categoryFilter}
              onCategoryChange={setCategoryFilter}
              isDragging={isDragging}
              favorites={favorites}
              onToggleFavorite={toggleFavorite}
              usageMap={usageMap}
              bundles={bundles}
              bundlesLoading={bundlesLoading}
              baskets={baskets}
              onAddProductToBasket={addProductToBasket}
              onAddBundleToBasket={addBundleToBasket}
              onOpenVisualPanel={() => setVisualPanelOpen(true)}
              pdfSelection={pdfSelection}
              onPopOutSelected={onPopOutSelected} />

          </div>
          <div ref={canvasRef} className="md:col-span-3 flex flex-col min-h-0 overflow-hidden pr-2">
            <div className="flex-1 min-h-0 overflow-y-auto" style={{ scrollBehavior: "smooth", WebkitOverflowScrolling: "touch" as any }}>
              <BasketCanvas
                baskets={baskets}
                allProducts={products}
                dbBundles={bundles}
                onAddBasket={handleAddBasket}
                onRenameBasket={handleRenameBasket}
                onRemoveBasket={handleRemoveBasket}
                onRemoveItem={handleRemoveItem}
                onUpdateQuantity={handleUpdateQuantity}
                onAddProductToBasket={addProductToBasket}
                onAddBundleToBasket={addBundleToBasket}
                onDuplicateBasket={handleDuplicateBasket}
                onApplyTemplate={handleApplyTemplate}
                onClearAll={handleClearAll}
                onUpdateLength={handleUpdateLength}
                isDragging={isDragging}
                isCompact={visualPanelOpen}
                areaBuilderNode={areaBuilderNode}
                areaAddZone={areaAddZone}
                areaApplyTemplate={areaApplyTemplate}
                areaClearAll={areaClearAll}
                areaCount={areaCount} />
            </div>
          </div>
        </div>

        <DragOverlay dropAnimation={null}>
          {activeProduct ? <DragOverlayCard product={activeProduct} /> : null}
        </DragOverlay>

        {/* Floating drop zone strip visible when dragging while Visual Catalog is open */}
        <FloatingDropZoneStrip baskets={baskets} visible={isDragging && visualPanelOpen} />

        <VisualCatalogPanel
          open={visualPanelOpen}
          onClose={() => setVisualPanelOpen(false)}
          baskets={baskets}
          onAddProductToBasket={addProductToBasket}
          onAddBasket={handleAddBasket}
          onRemoveBasket={handleRemoveBasket}
          products={products}
          isDragging={isDragging}
          onOpenWizard={handleOpenWizardFromPdf}
          pdfSelection={pdfSelection} />

      </DndContext>

      {/* Floating "Quote Summary · N items" bar removed — the right-hand
          Quote Summary panel already shows the same totals. */}

      <ACOptionsModal
        open={acModalOpen}
        onClose={() => setAcModalOpen(false)}
        products={products}
        initialProduct={acModalProduct}
        onConfirm={handleACConfirm}
        inferredBrand={inferredBrand}
        inferredType={inferredType} />


      <QuoteBuilderPopup
        open={wizardOpen}
        onClose={() => {setWizardOpen(false);setWizardTriggerItem(null);setWizardPreviewBaskets([]);}}
        products={products}
        bundles={bundles}
        onSave={handleWizardSave}
        triggerItem={wizardTriggerItem}
        onLivePreview={setWizardPreviewBaskets} />

    </div>);

};

export default QuoteBuilderTab;