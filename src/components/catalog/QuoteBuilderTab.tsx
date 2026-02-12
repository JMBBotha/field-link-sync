import { useState, useCallback, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import ProductPalette from "./quote-builder/ProductPalette";
import BasketCanvas from "./quote-builder/BasketCanvas";
import DragOverlayCard from "./quote-builder/DragOverlayCard";
import ACOptionsModal, { detectACType } from "./quote-builder/ACOptionsModal";
import QuoteSummaryPanel from "./quote-builder/QuoteSummaryPanel";

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
}

export interface BasketItem {
  instanceId: string;
  product: PaletteProduct;
  quantity: number;
}

export interface Basket {
  id: string;
  name: string;
  items: BasketItem[];
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

  // Fetch products for the palette
  const { data: products = [], isLoading } = useQuery({
    queryKey: ["quote-builder-products"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_products") as any)
        .select("id, product_code, short_name, brand, product_category, category, cost_excl_vat, cost_incl_vat, selling_price, description, is_pinned, pin_order, suppliers(name)")
        .or("archived.is.null,archived.eq.false")
        .order("is_pinned", { ascending: false })
        .order("pin_order", { ascending: true, nullsFirst: false })
        .limit(500);

      if (error) throw error;
      return (data || []).map((p: any) => ({
        ...p,
        product_category: p.product_category || p.category || "",
        supplier_name: p.suppliers?.name || "",
      })) as PaletteProduct[];
    },
    staleTime: 60000,
  });

  // ─── Brand & Type Inference ───
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

  // Client-side filtering
  const filteredProducts = useMemo(() => {
    let result = products;

    if (categoryFilter !== "all" && categoryFilter !== "favorites") {
      result = result.filter((p) =>
        p.product_category === categoryFilter ||
        (p.category || "").toLowerCase().includes(categoryFilter.toLowerCase())
      );
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((p) =>
        (p.product_code || "").toLowerCase().includes(q) ||
        (p.short_name || "").toLowerCase().includes(q) ||
        (p.brand || "").toLowerCase().includes(q) ||
        (p.description || "").toLowerCase().includes(q) ||
        (p.category || "").toLowerCase().includes(q)
      );
    }

    return result;
  }, [products, categoryFilter, searchQuery]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const addProductToBasket = useCallback((basketId: string, product: PaletteProduct) => {
    setBaskets((prev) =>
      prev.map((basket) => {
        if (basket.id !== basketId) return basket;
        const existing = basket.items.find((i) => i.product.id === product.id);
        if (existing) {
          return {
            ...basket,
            items: basket.items.map((i) =>
              i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i
            ),
          };
        }
        return {
          ...basket,
          items: [
            ...basket.items,
            { instanceId: `${product.id}-${Date.now()}`, product, quantity: 1 },
          ],
        };
      })
    );
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const product = products.find((p) => p.id === event.active.id);
    if (product) setActiveProduct(product);
  }, [products]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveProduct(null);
    const { active, over } = event;
    if (!over) return;

    const overId = String(over.id);
    let targetBasketId: string | null = null;
    if (overId.startsWith("basket-") || overId.startsWith("basket_")) {
      targetBasketId = overId;
    } else {
      for (const basket of baskets) {
        if (basket.items.some((i) => i.instanceId === overId)) {
          targetBasketId = basket.id;
          break;
        }
      }
    }

    if (!targetBasketId) return;

    const productId = String(active.id);
    const product = products.find((p) => p.id === productId);
    if (!product) return;

    addProductToBasket(targetBasketId, product);
  }, [products, baskets, addProductToBasket]);

  const handleDragOver = useCallback((_event: DragOverEvent) => {}, []);

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

  const handleProductClick = useCallback((product: PaletteProduct) => {
    if (product.product_category === "Air Conditioning") {
      setAcModalProduct(product);
      setAcModalOpen(true);
    }
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
        b.items.reduce(
          (s, i) => s + (i.product.selling_price || i.product.cost_incl_vat || 0) * i.quantity,
          0
        ),
      0
    );
  }, [baskets]);

  const totalItems = baskets.reduce((s, b) => s + b.items.reduce((qs, i) => qs + i.quantity, 0), 0);

  return (
    <div className="space-y-3">
      {/* Total bar */}
      <div className="flex items-center justify-between rounded-lg border bg-card p-3">
        <span className="text-sm font-medium text-muted-foreground">
          Quote Total ({totalItems} items across {baskets.length} zones)
        </span>
        <span className="text-lg font-bold text-foreground">
          R {totalCost.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" style={{ minHeight: 500 }}>
          <ProductPalette
            products={filteredProducts}
            isLoading={isLoading}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            categoryFilter={categoryFilter}
            onCategoryChange={setCategoryFilter}
            onProductClick={handleProductClick}
          />
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
          />
        </div>

        <DragOverlay dropAnimation={null}>
          {activeProduct ? <DragOverlayCard product={activeProduct} /> : null}
        </DragOverlay>
      </DndContext>

      {/* Quote Summary & Export */}
      <QuoteSummaryPanel baskets={baskets} />

      {/* AC Options Modal with inference */}
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
