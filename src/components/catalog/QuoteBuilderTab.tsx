import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { inclVatFromExcl } from "@/utils/pricing";
import { computePricing, resolveSupplierCode } from "@/lib/pricing";
import { extractBtu } from "@/lib/bundles";
import { findTierConfigForBtu, type BundleTier } from "@/lib/bundleTierConfig";
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
import { useBundleProducts } from "@/hooks/useBundleProducts";
import { allTermsMatchBlob } from "./searchSynonyms";
import QuoteBuilderPopup from "./quote-builder/QuoteBuilderPopup";
import type { WizardTriggerItem } from "./quote-builder/QuoteBuilderPopup";
import { computeBundlePricing } from "./quote-builder/BundleItemsPopover";

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
}

/** Returns the effective per-unit prices for a product, using computePricing
 *  to ensure supplier discounts (e.g. Samsung 20%) are always applied.
 */
export function getEffectiveUnitPrices(product: PaletteProduct, isLengthOverride?: boolean) {
  const isLength = isLengthOverride ?? (product.sold_in_length && !!product.price_per_metre);
  const pq = product.pack_qty && product.pack_qty > 1 && !isLength ? product.pack_qty : 1;

  const listPrice = product.cost_excl_vat || 0;
  const markupPct = product.default_markup_percent ?? product.markup_percent ?? 35;
  const supplierCode = resolveSupplierCode(product.supplier_name);

  // computePricing handles discount + markup; cost_price may already be discounted
  const pricing = computePricing(supplierCode, listPrice, markupPct, product.cost_price || null);

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

/* Sticky collapsible summary wrapper */
const StickyQuoteSummary = ({ baskets }: {baskets: Basket[];}) => {
  const [collapsed, setCollapsed] = useState(true);
  const totalItems = baskets.reduce((s, b) => s + b.items.length, 0);
  const totalCost = baskets.reduce(
    (sum, b) =>
    sum +
    b.items.reduce((s, i) => {
      if (i.isBundle && i.bundleUnitPrice) {
        return s + (i.bundlePricingType === "p/meter" ?
        i.bundleUnitPrice * (i.length || 1) :
        i.bundleUnitPrice * i.quantity);
      }
      if (i.product.sold_in_length && i.product.price_per_metre && i.length) {
        const { unitSell } = getEffectiveUnitPrices(i.product, true);
        return s + unitSell * i.length;
      }
      const { unitSell } = getEffectiveUnitPrices(i.product);
      return s + unitSell * i.quantity;
    }, 0),
    0
  );

  if (totalItems === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 md:absolute md:bottom-0 md:left-0 md:right-0">
      <div className="bg-card border-t shadow-lg rounded-t-lg mx-auto max-w-screen-2xl">
        {/* Toggle bar - always visible */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-accent/50 transition-colors">

          <span className="font-semibold text-foreground">
            Quote Summary · {totalItems} items · R{totalCost.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
          </span>
          {collapsed ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>
        {/* Expandable detail */}
        {!collapsed &&
        <div className="px-4 pb-3 max-h-[40vh] overflow-y-auto">
            <QuoteSummaryPanel baskets={baskets} />
          </div>
        }
      </div>
    </div>);

};

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
}

const QuoteBuilderTab = ({ onBasketsChange, pdfSelection, onPopOutSelected, areaBuilderNode, areaAddZone, areaApplyTemplate, areaClearAll, areaCount, areaDropProductToArea, areaDropBundleToArea }: QuoteBuilderTabProps = {}) => {
  const [baskets, setBasketsInternal] = useState<Basket[]>([
  { id: "basket-1", name: "Zone 1", items: [] }]
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
  const queryClient = useQueryClient();
  const { usageMap, trackUsage } = useProductUsageStats();
  const bundleProducts = useBundleProducts();
  const canvasRef = useRef<HTMLDivElement>(null);
  const addBundleToBasketRef = useRef<((basketId: string, bundle: any) => void) | null>(null);
  const prevBasketsRef = useRef<Basket[]>(baskets);
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
      select("id, product_code, short_name, brand, product_category, category, cost_price, cost_excl_vat, selling_price, description, is_pinned, pin_order, price_per_metre, sold_in_length, unit_length, pipe_size, is_material_favorite, suggested_consumables, pack_qty, default_markup_percent, btu_rating, suppliers(name, supplier_type)").
      or("archived.is.null,archived.eq.false").
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
        markup_percent: p.default_markup_percent ?? 35,
        default_markup_percent: p.default_markup_percent ?? 35,
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
  const { data: bundles = [], isLoading: bundlesLoading } = useQuery<PaletteBundle[]>({
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
      select("id, bundle_id, supplier_product_id, quantity, length_metres, is_length_item, is_optional, sort_order, supplier_products(id, product_code, short_name, brand, product_category, category, cost_excl_vat, cost_incl_vat, selling_price, description, is_pinned, pin_order, price_per_metre, sold_in_length, unit_length, suppliers(name))").
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
            unit_length: sp.unit_length || null
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
      const terms = debouncedSearch.toLowerCase().split(/\s+/).filter(Boolean);
      result = result.filter((p) => {
        const blob = [
        p.product_code, p.short_name, p.brand,
        p.description, p.category, p.product_category, p.supplier_name].
        filter(Boolean).join(" ").toLowerCase();
        return allTermsMatchBlob(terms, blob);
      });
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

  const buildTierBundleItems = useCallback((capacityLabel: string, tier: BundleTier): BasketItem | null => {
    console.log("[AutoBundle] buildTierBundleItems:start", {
      capacityLabel,
      tier: tier.tier,
      tierLabel: tier.label,
      lines: tier.lines.length,
      productsLoaded: products.length,
      bundleProductsLoaded: Object.keys(bundleProducts).length,
    });

    const subItems: BasketItem["bundleItems"] = [];
    for (const line of tier.lines) {
      const code = (line.productCode || "").trim().toUpperCase();
      const prod = bundleProducts[code] as PaletteProduct | undefined;

      if (!prod) {
        console.warn("[AutoBundle] buildTierBundleItems:missingProduct", {
          capacityLabel,
          tier: tier.tier,
          code,
        });
        continue;
      }

      const isLength = prod.sold_in_length && !!prod.price_per_metre && !!line.lengthMetres;
      trackUsage(prod.id);
      subItems.push({
        product: prod,
        quantity: line.quantity,
        isLengthItem: isLength,
        ...(isLength ? { length: line.lengthMetres } : {}),
      });

      console.log("[AutoBundle] buildTierBundleItems:lineMatched", {
        capacityLabel,
        tier: tier.tier,
        code,
        productId: prod.id,
        isLength,
      });
    }

    if (subItems.length === 0) {
      console.warn("[AutoBundle] buildTierBundleItems:emptyTier", {
        capacityLabel,
        tier: tier.tier,
      });
      return null;
    }

    const { pricingType, unitPrice, unitCost } = computeBundlePricing(subItems as any);
    const firstProduct = subItems[0].product;
    const tierId = `tier-${capacityLabel}-${tier.tier}`;
    const tierName = `${capacityLabel} T${tier.tier}: ${tier.label}`;

    console.log("[AutoBundle] buildTierBundleItems:done", {
      capacityLabel,
      tier: tier.tier,
      matchedLines: subItems.length,
      pricingType,
      unitPrice,
    });

    return {
      instanceId: `${tierId}-${Date.now()}-${tier.tier}`,
      product: {
        ...firstProduct,
        short_name: tierName,
        description: `${tierName} (${subItems.length} items)`,
        product_code: `TIER-${capacityLabel}-${tier.tier}`,
        product_category: "Consumables",
        selling_price: unitPrice,
        cost_excl_vat: unitCost,
        cost_incl_vat: inclVatFromExcl(unitCost),
        sold_in_length: pricingType === "p/meter",
        price_per_metre: pricingType === "p/meter" ? unitPrice : null,
      },
      quantity: 1,
      ...(pricingType === "p/meter" ? { length: 1 } : {}),
      isBundle: true,
      bundleId: tierId,
      bundleName: tierName,
      tier_bundle: true,
      tier_name: (`T${tier.tier}` as "T1" | "T2" | "T3"),
      bundleItems: subItems,
      bundlePricingType: pricingType,
      bundleUnitPrice: unitPrice,
      bundleUnitCost: unitCost,
    };
  }, [products.length, bundleProducts, trackUsage]);

  const addProductToBasket = useCallback((basketId: string, product: PaletteProduct, source: string = "unknown") => {
    trackUsage(product.id);

    const parsedBtu = extractBtu(product);
    console.log("[AutoBundle] Product added:", product.short_name || product.product_code, "category:", product.category, "product_category:", product.product_category, "btu_rating:", product.btu_rating, "parsed BTU:", parsedBtu, "source:", source);

    setBaskets((prev) =>
      prev.map((basket) => {
        if (basket.id !== basketId) return basket;

        const existing = basket.items.find((i) => i.product.id === product.id);
        if (existing) {
          if (product.sold_in_length && product.price_per_metre) {
            return {
              ...basket,
              items: basket.items.map((i) =>
                i.product.id === product.id ? { ...i, length: (i.length || 1) + 1 } : i
              ),
            };
          }
          return {
            ...basket,
            items: basket.items.map((i) =>
              i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i
            ),
          };
        }

        const isLengthItem = product.sold_in_length && !!product.price_per_metre;
        const newItem: BasketItem = {
          instanceId: `${product.id}-${Date.now()}`,
          product,
          quantity: 1,
          ...(isLengthItem ? { length: product.unit_length || 1 } : {}),
        };

        return { ...basket, items: [...basket.items, newItem] };
      })
    );

    scrollToCanvas();
  }, [trackUsage, scrollToCanvas]);

  // Auto-attach 3-tier bundles by observing basket diffs (covers click, drag, modal, imports, restore paths)
  useEffect(() => {
    if (products.length === 0) {
      return;
    }

    const bundleProductsLoaded = Object.keys(bundleProducts).length;
    if (bundleProductsLoaded === 0) {
      console.log("[AutoBundleEffect] waiting for bundleProducts map before attaching tiers");
      return;
    }

    const prevBaskets = prevBasketsRef.current;
    const additionsByBasket = new Map<string, BasketItem[]>();

    for (const basket of baskets) {
      const prevBasket = prevBaskets.find((b) => b.id === basket.id);
      const prevIds = new Set((prevBasket?.items || []).map((i) => i.instanceId));

      const newAcItems = basket.items.filter((i) => {
        if (i.isBundle) return false;
        if (!isAirConditioningProduct(i.product)) return false;
        return !prevIds.has(i.instanceId);
      });

      if (newAcItems.length === 0) continue;

      console.log("[AutoBundleEffect] new AC items detected", {
        basketId: basket.id,
        basketName: basket.name,
        count: newAcItems.length,
      });

      for (const acItem of newAcItems) {
        const btu = extractBtu(acItem.product);
        console.log("[AutoBundleEffect] processing AC item", {
          basketId: basket.id,
          product: acItem.product.short_name || acItem.product.product_code,
          product_category: acItem.product.product_category,
          category: acItem.product.category,
          btu_rating: acItem.product.btu_rating,
          parsedBtu: btu,
        });

        if (!btu) {
          console.warn("[AutoBundleEffect] no BTU resolved; skipping auto-bundle", {
            basketId: basket.id,
            productId: acItem.product.id,
          });
          continue;
        }

        const tierConfig = findTierConfigForBtu(btu);
        if (!tierConfig) {
          console.warn("[AutoBundleEffect] no tier config for BTU", { btu, basketId: basket.id });
          continue;
        }

        const tierPrefix = `tier-${tierConfig.capacityLabel}-`;
        const alreadyHasTiers = basket.items.some(
          (i) => i.isBundle && i.bundleId?.startsWith(tierPrefix)
        );

        console.log("[AutoBundleEffect] tier check", {
          basketId: basket.id,
          capacity: tierConfig.capacityLabel,
          tierPrefix,
          alreadyHasTiers,
        });

        if (alreadyHasTiers) continue;

        const built: BasketItem[] = [];
        for (const tier of tierConfig.tiers) {
          const tierItem = buildTierBundleItems(tierConfig.capacityLabel, tier);
          if (tierItem) built.push(tierItem);
        }

        console.log("[AutoBundleEffect] built tier bundles", {
          basketId: basket.id,
          capacity: tierConfig.capacityLabel,
          builtCount: built.length,
        });

        if (built.length > 0) {
          const current = additionsByBasket.get(basket.id) || [];
          additionsByBasket.set(basket.id, [...current, ...built]);
        }
      }
    }

    if (additionsByBasket.size > 0) {
      setBaskets((prev) =>
        prev.map((basket) => {
          const additions = additionsByBasket.get(basket.id);
          if (!additions || additions.length === 0) return basket;

          const existingBundleIds = new Set(
            basket.items.filter((i) => i.isBundle && i.bundleId).map((i) => i.bundleId as string)
          );
          const uniqueAdditions = additions.filter((item) => !existingBundleIds.has(item.bundleId || ""));

          console.log("[AutoBundleEffect] injecting bundles", {
            basketId: basket.id,
            requested: additions.length,
            injected: uniqueAdditions.length,
          });

          if (uniqueAdditions.length === 0) return basket;
          return { ...basket, items: [...basket.items, ...uniqueAdditions] };
        })
      );

      const totalInjected = Array.from(additionsByBasket.values()).reduce((s, arr) => s + arr.length, 0);
      toast({ title: `Auto-added ${totalInjected} tier bundle(s)` });
    }

    prevBasketsRef.current = baskets;
  }, [baskets, products.length, bundleProducts, buildTierBundleItems, isAirConditioningProduct]);

  const addBundleToBasket = useCallback((basketId: string, bundle: PaletteBundle) => {
    // Build sub-items list for the collapsed bundle
    const subItems = bundle.items.
    filter((bItem) => bItem.product).
    map((bItem) => {
      trackUsage(bItem.product!.id);
      const isLengthItem = bItem.is_length_item && !!bItem.product!.price_per_metre;
      return {
        product: bItem.product as PaletteProduct,
        quantity: bItem.quantity,
        isLengthItem,
        isOptional: bItem.is_optional,
        ...(isLengthItem ? { length: bItem.length_metres || bItem.product!.unit_length || 1 } : {})
      };
    });

    // Compute pricing
    const { pricingType, unitPrice, unitCost } = computeBundlePricing(subItems);

    // Use the first product as a "representative" for the bundle line
    const firstProduct = subItems.find((i) => !i.isOptional)?.product || subItems[0]?.product;
    if (!firstProduct) return;

    const bundleItem: BasketItem = {
      instanceId: `bundle-${bundle.id}-${Date.now()}`,
      product: {
        ...firstProduct,
        short_name: bundle.name,
        description: `Bundle: ${bundle.name} (${subItems.length} items)`,
        product_code: `BUNDLE-${bundle.id.slice(0, 6).toUpperCase()}`,
        product_category: firstProduct.product_category,
        selling_price: unitPrice,
        cost_excl_vat: unitCost,
        cost_incl_vat: inclVatFromExcl(unitCost),
        sold_in_length: pricingType === "p/meter",
        price_per_metre: pricingType === "p/meter" ? unitPrice : null
      },
      quantity: 1,
      ...(pricingType === "p/meter" ? { length: 1 } : {}),
      isBundle: true,
      bundleId: bundle.id,
      bundleName: bundle.name,
      bundleItems: subItems,
      bundlePricingType: pricingType,
      bundleUnitPrice: unitPrice,
      bundleUnitCost: unitCost
    };

    setBaskets((prev) =>
    prev.map((basket) => {
      if (basket.id !== basketId) return basket;
      return { ...basket, items: [...basket.items, bundleItem] };
    })
    );
    scrollToCanvas();
  }, [trackUsage, scrollToCanvas]);
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

  const totalCost = useMemo(() => {
    return baskets.reduce(
      (sum, b) =>
      sum +
      b.items.reduce((s, i) => {
        if (i.isBundle && i.bundleUnitPrice) {
          return s + (i.bundlePricingType === "p/meter" ?
          i.bundleUnitPrice * (i.length || 1) :
          i.bundleUnitPrice * i.quantity);
        }
        if (i.product.sold_in_length && i.product.price_per_metre && i.length) {
          return s + i.product.price_per_metre * i.length;
        }
        return s + (i.product.selling_price || i.product.cost_incl_vat || 0) * i.quantity;
      }, 0),
      0
    );
  }, [baskets]);

  const totalItems = baskets.reduce((s, b) => s + b.items.reduce((qs, i) => qs + i.quantity, 0), 0);

  const handleClearAll = useCallback(() => {
    setBaskets([]);
  }, []);

  const handleWizardSave = useCallback((newBaskets: Basket[]) => {
    setBaskets((prev) => [...prev, ...newBaskets]);
    toast({ title: `Added ${newBaskets.length} zones from Area Quote Builder` });
  }, []);

  const handleOpenWizardFromPdf = useCallback((item: WizardTriggerItem) => {
    setWizardTriggerItem(item);
    setVisualPanelOpen(false); // Close Visual Catalog
    setWizardOpen(true);
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden gap-3 relative pb-2 min-w-0">
      <div className="border bg-card p-3 z-10 shadow-sm shrink-0 rounded-sm py-[6px] mx-[4px] my-[8px] flex flex-col gap-[6px]">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">
            Quote Total ({totalItems} items across {baskets.length} zones)
          </span>
          <span className="text-lg font-bold text-foreground">
            R {totalCost.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 flex-1 min-h-0 overflow-hidden px-2">
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

      {/* Sticky collapsible quote summary at bottom */}
      <StickyQuoteSummary baskets={baskets} />

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
        onClose={() => {setWizardOpen(false);setWizardTriggerItem(null);}}
        products={products}
        bundles={bundles}
        onSave={handleWizardSave}
        triggerItem={wizardTriggerItem} />

    </div>);

};

export default QuoteBuilderTab;