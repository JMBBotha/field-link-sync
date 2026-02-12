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

  // Fetch products for the palette
  const { data: products = [], isLoading } = useQuery({
    queryKey: ["quote-builder-products", searchQuery, categoryFilter],
    queryFn: async () => {
      let query = (supabase.from("supplier_products") as any)
        .select("id, product_code, short_name, brand, product_category, category, cost_excl_vat, cost_incl_vat, selling_price, description, is_pinned, pin_order, suppliers(name)")
        .or("archived.is.null,archived.eq.false")
        .order("is_pinned", { ascending: false })
        .order("pin_order", { ascending: true, nullsFirst: false })
        .limit(80);

      if (categoryFilter !== "all") {
        query = query.or(`product_category.eq.${categoryFilter},category.ilike.%${categoryFilter}%`);
      }

      if (searchQuery.trim()) {
        query = query.or(`product_code.ilike.%${searchQuery}%,short_name.ilike.%${searchQuery}%,brand.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%,category.ilike.%${searchQuery}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []).map((p: any) => ({
        ...p,
        product_category: p.product_category || p.category || "",
        supplier_name: p.suppliers?.name || "",
      })) as PaletteProduct[];
    },
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const product = products.find((p) => p.id === event.active.id);
    if (product) setActiveProduct(product);
  }, [products]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveProduct(null);
    const { active, over } = event;
    if (!over) return;

    const overId = String(over.id);
    // Find the target basket
    let targetBasketId: string | null = null;
    if (overId.startsWith("basket-")) {
      targetBasketId = overId;
    } else {
      // Could be dropping over an item inside a basket
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

    setBaskets((prev) =>
      prev.map((basket) => {
        if (basket.id !== targetBasketId) return basket;
        // Check if product already exists in basket
        const existing = basket.items.find((i) => i.product.id === productId);
        if (existing) {
          return {
            ...basket,
            items: basket.items.map((i) =>
              i.product.id === productId ? { ...i, quantity: i.quantity + 1 } : i
            ),
          };
        }
        return {
          ...basket,
          items: [
            ...basket.items,
            { instanceId: `${productId}-${Date.now()}`, product, quantity: 1 },
          ],
        };
      })
    );
  }, [products, baskets]);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    // intentionally minimal for now
  }, []);

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

  return (
    <div className="space-y-3">
      {/* Total bar */}
      <div className="flex items-center justify-between rounded-lg border bg-card p-3">
        <span className="text-sm font-medium text-muted-foreground">
          Quote Total ({baskets.reduce((s, b) => s + b.items.length, 0)} items)
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
          {/* Left: Product Palette */}
          <ProductPalette
            products={products}
            isLoading={isLoading}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            categoryFilter={categoryFilter}
            onCategoryChange={setCategoryFilter}
          />

          {/* Right: Basket Canvas */}
          <BasketCanvas
            baskets={baskets}
            onAddBasket={handleAddBasket}
            onRenameBasket={handleRenameBasket}
            onRemoveBasket={handleRemoveBasket}
            onRemoveItem={handleRemoveItem}
            onUpdateQuantity={handleUpdateQuantity}
          />
        </div>

        <DragOverlay dropAnimation={null}>
          {activeProduct ? <DragOverlayCard product={activeProduct} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
};

export default QuoteBuilderTab;
