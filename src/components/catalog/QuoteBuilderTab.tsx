import { useState, useCallback, useMemo, useRef } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import ProductPalette from "./quote-builder/ProductPalette";
import type { PaletteBundle } from "./quote-builder/ProductPalette";
import VisualCatalogPanel from "./quote-builder/VisualCatalogPanel";
import BasketCanvas from "./quote-builder/BasketCanvas";
import DragOverlayCard from "./quote-builder/DragOverlayCard";
import ACOptionsModal, { detectACType } from "./quote-builder/ACOptionsModal";
import QuoteSummaryPanel from "./quote-builder/QuoteSummaryPanel";
// favorites now derived from is_pinned on product data
import { useProductUsageStats } from "@/hooks/useProductUsageStats";
import { allTermsMatchBlob } from "./searchSynonyms";

export interface PaletteProduct {
  id: string;
  product_code: string;
  short_name: string;
  brand: string;
  product_category: string;
  category: string;
  cost_excl_vat: number;
  cost_incl_vat: number;
  selling_price: number;
  description: string;
  is_pinned: boolean;
  pin_order: number | null;
  supplier_name: string;
  price_per_metre: number | null;
  sold_in_length: boolean;
  unit_length: number | null;
}

export interface BasketItem {
  instanceId: string;
  product: PaletteProduct;
  quantity: number;
  length?: number;
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
      handler: ({ nativeEvent }: { nativeEvent: PointerEvent }) => {
        const target = nativeEvent.target as HTMLElement | null;
        if (target?.closest?.('[data-no-dnd="true"]')) {
          return false;
        }
        return true;
      },
    },
  ];
}

const QuoteBuilderTab = () => {
  const [baskets, setBaskets] = useState<Basket[]>([
    { id: "basket-1", name: "Room 1 AC", items: [] },
    { id: "basket-2", name: "Piping", items: [] },
    { id: "basket-3", name: "Electrical", items: [] },
  ]);
  const [activeProduct, setActiveProduct] = useState<PaletteProduct | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [acModalOpen, setAcModalOpen] = useState(false);
  const [acModalProduct, setAcModalProduct] = useState<PaletteProduct | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [visualPanelOpen, setVisualPanelOpen] = useState(false);

  const queryClient = useQueryClient();
  const { usageMap, trackUsage } = useProductUsageStats();
  const canvasRef = useRef<HTMLDivElement>(null);
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
      const { data, error } = await (supabase.from("supplier_products") as any)
        .select("id, product_code, short_name, brand, product_category, category, cost_excl_vat, cost_incl_vat, selling_price, description, is_pinned, pin_order, price_per_metre, sold_in_length, unit_length, suppliers(name)")
        .or("archived.is.null,archived.eq.false")
        .order("is_pinned", { ascending: false })
        .order("pin_order", { ascending: true, nullsFirst: false })
        .limit(500);

      if (error) throw error;
      return (data || []).map((p: any) => ({
        ...p,
        product_category: p.product_category || p.category || "",
        supplier_name: p.suppliers?.name || "",
        price_per_metre: p.price_per_metre || null,
        sold_in_length: p.sold_in_length || false,
        unit_length: p.unit_length || null,
      })) as PaletteProduct[];
    },
    staleTime: 60000,
  });

  const favorites = useMemo(() => new Set(products.filter(p => p.is_pinned).map(p => p.id)), [products]);
  const togglePinMutation = useMutation({
    mutationFn: async (productId: string) => {
      const currentlyPinned = products.find(p => p.id === productId)?.is_pinned ?? false;
      const pinOrder = currentlyPinned ? 0 : Math.floor(Date.now() / 1000) % 2000000000;
      const { error } = await (supabase.from("supplier_products") as any)
        .update({ is_pinned: !currentlyPinned, pin_order: pinOrder } as any).eq("id", productId);
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
    },
  });
  const toggleFavorite = useCallback((id: string) => togglePinMutation.mutate(id), [togglePinMutation]);

  // Fetch bundles with their items + products
  const { data: bundles = [], isLoading: bundlesLoading } = useQuery<PaletteBundle[]>({
    queryKey: ["quote-builder-bundles"],
    queryFn: async () => {
      const { data: bundleData, error: bErr } = await supabase
        .from("installation_bundles")
        .select("id, name, description, bundle_type")
        .eq("is_active", true)
        .order("name");
      if (bErr) throw bErr;
      if (!bundleData || bundleData.length === 0) return [];

      const { data: itemsData, error: iErr } = await (supabase.from("bundle_items") as any)
        .select("id, bundle_id, supplier_product_id, quantity, length_metres, is_length_item, is_optional, sort_order, supplier_products(id, product_code, short_name, brand, product_category, category, cost_excl_vat, cost_incl_vat, selling_price, description, is_pinned, pin_order, price_per_metre, sold_in_length, unit_length, suppliers(name))")
        .order("sort_order");
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
          } : null,
        });
      });

      return bundleData.map((b) => ({
        ...b,
        items: itemsByBundle[b.id] || [],
      }));
    },
    staleTime: 60000,
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
    if (!searchQuery.trim() && categoryFilter !== "all" && categoryFilter !== "favorites") {
      result = result.filter((p) =>
        p.product_category === categoryFilter ||
        (p.category || "").toLowerCase().includes(categoryFilter.toLowerCase())
      );
    }

    if (searchQuery.trim()) {
      const terms = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
      result = result.filter((p) => {
        const blob = [
          p.product_code, p.short_name, p.brand,
          p.description, p.category, p.product_category, p.supplier_name,
        ].filter(Boolean).join(" ").toLowerCase();
        // ALL terms must match somewhere in the combined blob (with synonym expansion)
        return allTermsMatchBlob(terms, blob);
      });
      console.log(`[Search] query="${searchQuery}" terms=[${terms.join(",")}] results=${result.length}`);
    }

    return result;
  }, [products, categoryFilter, searchQuery]);

  const sensors = useSensors(
    useSensor(NoDndPointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const addProductToBasket = useCallback((basketId: string, product: PaletteProduct) => {
    // Track usage
    trackUsage(product.id);

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
        return {
          ...basket,
          items: [
            ...basket.items,
            {
              instanceId: `${product.id}-${Date.now()}`,
              product,
              quantity: 1,
              ...(isLengthItem ? { length: product.unit_length || 1 } : {}),
            },
          ],
        };
      })
    );
    scrollToCanvas();
  }, [trackUsage, scrollToCanvas]);

  const addBundleToBasket = useCallback((basketId: string, bundle: PaletteBundle) => {
    setBaskets((prev) =>
      prev.map((basket) => {
        if (basket.id !== basketId) return basket;
        const newItems: BasketItem[] = [];
        for (const bItem of bundle.items) {
          if (!bItem.product) continue;
          if (bItem.is_optional) continue;
          trackUsage(bItem.product.id);
          const isLengthItem = bItem.is_length_item && !!bItem.product.price_per_metre;
          newItems.push({
            instanceId: `${bItem.product.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            product: bItem.product as PaletteProduct,
            quantity: bItem.quantity,
            ...(isLengthItem ? { length: bItem.length_metres || bItem.product.unit_length || 1 } : {}),
          });
        }
        return { ...basket, items: [...basket.items, ...newItems] };
      })
    );
    scrollToCanvas();
  }, [trackUsage, scrollToCanvas]);

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
    let targetBasketId: string | null = null;
    for (const basket of baskets) {
      if (basket.id === overId) {
        targetBasketId = basket.id;
        break;
      }
    }
    if (!targetBasketId) return;

    // Check if it's a bundle drop
    const bundleData = (active.data.current as any)?.bundle;
    if (bundleData) {
      addBundleToBasket(targetBasketId, bundleData);
      return;
    }

    const product = (active.data.current as any)?.product as PaletteProduct | undefined;
    if (!product) return;
    addProductToBasket(targetBasketId, product);
  }, [baskets, addProductToBasket, addBundleToBasket]);

  const handleRemoveItem = useCallback((basketId: string, instanceId: string) => {
    setBaskets((prev) =>
      prev.map((b) =>
        b.id === basketId
          ? { ...b, items: b.items.filter((i) => i.instanceId !== instanceId) }
          : b
      )
    );
  }, []);

  const handleUpdateQuantity = useCallback((basketId: string, instanceId: string, qty: number) => {
    if (qty < 1) return;
    setBaskets((prev) =>
      prev.map((b) =>
        b.id === basketId
          ? {
              ...b,
              items: b.items.map((i) =>
                i.instanceId === instanceId ? { ...i, quantity: qty } : i
              ),
            }
          : b
      )
    );
  }, []);

  const handleUpdateLength = useCallback((basketId: string, instanceId: string, length: number) => {
    if (length < 0.1) return;
    setBaskets((prev) =>
      prev.map((b) =>
        b.id === basketId
          ? {
              ...b,
              items: b.items.map((i) =>
                i.instanceId === instanceId ? { ...i, length } : i
              ),
            }
          : b
      )
    );
  }, []);

  const handleAddBasket = useCallback(() => {
    const id = `basket-${Date.now()}`;
    setBaskets((prev) => [...prev, { id, name: `Zone ${prev.length + 1}`, items: [] }]);
  }, []);

  const handleRenameBasket = useCallback((basketId: string, newName: string) => {
    setBaskets((prev) =>
      prev.map((b) => (b.id === basketId ? { ...b, name: newName } : b))
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
          instanceId: `${i.product.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        })),
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
      items: [] as BasketItem[],
    }));
    setBaskets(newBaskets);
  }, []);

  const handleACConfirm = useCallback((product: PaletteProduct) => {
    const targetBasket = baskets[0];
    if (targetBasket) {
      addProductToBasket(targetBasket.id, product);
    }
  }, [baskets, addProductToBasket]);

  const totalCost = useMemo(() => {
    return baskets.reduce(
      (sum, b) =>
        sum +
        b.items.reduce((s, i) => {
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

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 rounded-lg border bg-card p-3 sticky top-0 z-10 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">
            Quote Total ({totalItems} items across {baskets.length} zones)
          </span>
          <span className="text-lg font-bold text-foreground">
            R {totalCost.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search products..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4" style={{ minHeight: 500 }}>
          <div className="md:col-span-2 md:max-h-[calc(100vh-280px)] md:overflow-y-auto">
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
              onOpenVisualPanel={() => setVisualPanelOpen(true)}
            />
          </div>
          <div ref={canvasRef} className="md:col-span-3 md:max-h-[calc(100vh-280px)] md:overflow-y-auto">
            <BasketCanvas
              baskets={baskets}
              allProducts={products}
              onAddBasket={handleAddBasket}
              onRenameBasket={handleRenameBasket}
              onRemoveBasket={handleRemoveBasket}
              onRemoveItem={handleRemoveItem}
              onUpdateQuantity={handleUpdateQuantity}
              onAddProductToBasket={addProductToBasket}
              onDuplicateBasket={handleDuplicateBasket}
              onApplyTemplate={handleApplyTemplate}
              onClearAll={handleClearAll}
              onUpdateLength={handleUpdateLength}
              isDragging={isDragging}
            />
          </div>
        </div>

        <DragOverlay dropAnimation={null}>
          {activeProduct ? <DragOverlayCard product={activeProduct} /> : null}
        </DragOverlay>
      </DndContext>

      <QuoteSummaryPanel baskets={baskets} />

      <VisualCatalogPanel
        open={visualPanelOpen}
        onClose={() => setVisualPanelOpen(false)}
        baskets={baskets}
        onAddProductToBasket={addProductToBasket}
      />

      <ACOptionsModal
        open={acModalOpen}
        onClose={() => setAcModalOpen(false)}
        products={products}
        initialProduct={acModalProduct}
        onConfirm={handleACConfirm}
        inferredBrand={inferredBrand}
        inferredType={inferredType}
      />
    </div>
  );
};

export default QuoteBuilderTab;
