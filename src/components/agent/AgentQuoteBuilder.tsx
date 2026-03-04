import { useState, useCallback, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useDroppable } from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Trash2, Package, ShoppingBag, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SharedBasketItemCard } from "@/components/shared/SharedBasketItems";
import QuoteSummaryPanel from "@/components/catalog/quote-builder/QuoteSummaryPanel";
import type { PaletteProduct, BasketItem, Basket } from "@/components/catalog/QuoteBuilderTab";
import { getEffectiveUnitPrices } from "@/components/catalog/QuoteBuilderTab";
import { getProductDisplayName } from "@/components/catalog/quote-builder/productDisplayUtils";
import { getCategoryIcon, getCategoryBg } from "@/components/catalog/quote-builder/ProductPalette";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

/* ─── Draggable product card for agent palette ─── */
function AgentDraggableProduct({ product }: { product: PaletteProduct }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `product-${product.id}`,
    data: { product },
  });

  const { unitSell } = getEffectiveUnitPrices(product);

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`flex items-center gap-2 rounded-md border bg-card p-2 cursor-grab active:cursor-grabbing transition-opacity ${
        isDragging ? "opacity-40" : "opacity-100"
      }`}
    >
      <GripVertical className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <div className={`shrink-0 rounded p-1 ${getCategoryBg(product.product_category)}`}>
        {getCategoryIcon(product.product_category, "h-3 w-3")}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate">{getProductDisplayName(product)}</p>
        <p className="text-[10px] text-muted-foreground font-mono">{product.product_code}</p>
      </div>
      <span className="text-xs font-bold shrink-0 text-foreground">
        R{unitSell.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}
      </span>
    </div>
  );
}

/* ─── Droppable zone for agent ─── */
function AgentDroppableZone({
  basket,
  onRemoveItem,
  onUpdateQuantity,
  onUpdateLength,
  onRemoveBasket,
  isDragActive,
}: {
  basket: Basket;
  onRemoveItem: (instanceId: string) => void;
  onUpdateQuantity: (instanceId: string, qty: number) => void;
  onUpdateLength: (instanceId: string, len: number) => void;
  onRemoveBasket: () => void;
  isDragActive: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: basket.id });

  const subtotal = basket.items.reduce((s, i) => {
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

  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border-2 border-dashed transition-all ${
        isOver
          ? "border-primary bg-primary/10 ring-2 ring-primary/20"
          : isDragActive
            ? "border-primary/40 bg-primary/5"
            : "border-border bg-card"
      }`}
    >
      <div className="flex items-center justify-between p-2 border-b border-border/50">
        <div className="flex items-center gap-1.5">
          <ShoppingBag className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-foreground">{basket.name}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs font-bold text-foreground">
            R{subtotal.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}
          </span>
          <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive/60 hover:text-destructive" onClick={onRemoveBasket}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <div className="p-2 space-y-1" style={{ minHeight: 80 }}>
        {basket.items.length === 0 ? (
          <div className={`flex flex-col items-center justify-center py-4 rounded-md transition-colors ${
            isOver ? "bg-primary/10 text-primary" : "text-muted-foreground"
          }`}>
            <Package className="h-5 w-5 mb-1 opacity-40" />
            <p className="text-xs">{isOver ? "Release to drop" : "Drag products here"}</p>
          </div>
        ) : (
          basket.items.map((item) => (
            <SharedBasketItemCard
              key={item.instanceId}
              item={item}
              onRemove={() => onRemoveItem(item.instanceId)}
              onUpdateQuantity={(qty) => onUpdateQuantity(item.instanceId, qty)}
              onUpdateLength={(len) => onUpdateLength(item.instanceId, len)}
            />
          ))
        )}
      </div>
    </div>
  );
}

/* ─── Main Agent Quote Builder ─── */
const AgentQuoteBuilder = () => {
  const [baskets, setBaskets] = useState<Basket[]>([
    { id: "agent-zone-1", name: "Zone 1", items: [] },
  ]);
  const [activeDragProduct, setActiveDragProduct] = useState<PaletteProduct | null>(null);
  const [search, setSearch] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );

  // Fetch products
  const { data: products = [] } = useQuery({
    queryKey: ["agent-products"],
    queryFn: async () => {
      const { data } = await supabase
        .from("supplier_products")
        .select("*")
        .limit(500);
      return (data || []).map((p: any) => ({
        id: p.id,
        product_code: p.product_code || "",
        short_name: p.short_name || p.description || "",
        brand: p.brand || "",
        product_category: p.product_category || "",
        category: p.category || "",
        cost_excl_vat: p.cost_excl_vat || 0,
        cost_incl_vat: p.cost_incl_vat || 0,
        selling_price: p.selling_price || 0,
        description: p.description || "",
        is_pinned: p.is_pinned || false,
        pin_order: p.pin_order,
        supplier_name: p.supplier_name || "",
        supplier_type: p.supplier_type || "",
        price_per_metre: p.price_per_metre,
        sold_in_length: p.sold_in_length || false,
        unit_length: p.unit_length,
        pipe_size: p.pipe_size,
        is_material_favorite: p.is_material_favorite || false,
        pack_qty: p.pack_qty,
        supplier_discount_percent: p.supplier_discount_percent,
        markup_percent: p.markup_percent,
      })) as PaletteProduct[];
    },
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return products.slice(0, 50);
    const q = search.toLowerCase();
    return products
      .filter((p) =>
        p.short_name.toLowerCase().includes(q) ||
        p.product_code.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q)
      )
      .slice(0, 50);
  }, [products, search]);

  const handleDragStart = useCallback((e: DragStartEvent) => {
    const product = (e.active.data?.current as any)?.product as PaletteProduct | undefined;
    setActiveDragProduct(product || null);
  }, []);

  const handleDragEnd = useCallback((e: DragEndEvent) => {
    setActiveDragProduct(null);
    const product = (e.active.data?.current as any)?.product as PaletteProduct | undefined;
    const overId = e.over?.id as string | undefined;
    if (!product || !overId) return;

    const basket = baskets.find((b) => b.id === overId);
    if (!basket) return;

    setBaskets((prev) =>
      prev.map((b) =>
        b.id === overId
          ? {
              ...b,
              items: [
                ...b.items,
                {
                  instanceId: `${product.id}-${Date.now()}`,
                  product,
                  quantity: 1,
                  length: product.sold_in_length ? 1 : undefined,
                },
              ],
            }
          : b
      )
    );
  }, [baskets]);

  const addZone = () => {
    const id = `agent-zone-${Date.now()}`;
    setBaskets((prev) => [...prev, { id, name: `Zone ${prev.length + 1}`, items: [] }]);
  };

  const removeBasket = (id: string) => setBaskets((prev) => prev.filter((b) => b.id !== id));

  const removeItem = (basketId: string, instanceId: string) =>
    setBaskets((prev) =>
      prev.map((b) =>
        b.id === basketId ? { ...b, items: b.items.filter((i) => i.instanceId !== instanceId) } : b
      )
    );

  const updateQuantity = (basketId: string, instanceId: string, qty: number) =>
    setBaskets((prev) =>
      prev.map((b) =>
        b.id === basketId
          ? { ...b, items: b.items.map((i) => (i.instanceId === instanceId ? { ...i, quantity: Math.max(1, qty) } : i)) }
          : b
      )
    );

  const updateLength = (basketId: string, instanceId: string, length: number) =>
    setBaskets((prev) =>
      prev.map((b) =>
        b.id === basketId
          ? { ...b, items: b.items.map((i) => (i.instanceId === instanceId ? { ...i, length: Math.max(0.1, length) } : i)) }
          : b
      )
    );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-[calc(100vh-120px)] gap-3 p-3">
        {/* Product Palette */}
        <div className="w-72 shrink-0 flex flex-col rounded-lg border bg-card overflow-hidden">
          <div className="p-2 border-b">
            <Input
              placeholder="Search products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1.5">
              {filtered.map((product) => (
                <AgentDraggableProduct key={product.id} product={product} />
              ))}
              {filtered.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">No products found</p>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Zones */}
        <div className="flex-1 flex flex-col rounded-lg border bg-muted/30 overflow-hidden">
          <div className="flex items-center justify-between p-3 border-b shrink-0">
            <h3 className="text-sm font-semibold text-foreground">Quote Zones</h3>
            <Button variant="outline" size="sm" className="gap-1 h-7 text-xs" onClick={addZone}>
              <Plus className="h-3 w-3" /> Add Zone
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-3">
              {baskets.map((basket) => (
                <AgentDroppableZone
                  key={basket.id}
                  basket={basket}
                  onRemoveItem={(iid) => removeItem(basket.id, iid)}
                  onUpdateQuantity={(iid, qty) => updateQuantity(basket.id, iid, qty)}
                  onUpdateLength={(iid, len) => updateLength(basket.id, iid, len)}
                  onRemoveBasket={() => removeBasket(basket.id)}
                  isDragActive={!!activeDragProduct}
                />
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Summary with M/Up */}
        <div className="w-64 shrink-0 rounded-lg border bg-card p-3 overflow-y-auto">
          <h3 className="text-sm font-semibold text-foreground mb-3">Quote Summary</h3>
          <QuoteSummaryPanel baskets={baskets} />
        </div>
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activeDragProduct && (
          <div className="rounded-md border bg-card p-2 shadow-xl text-xs opacity-90 max-w-[200px]">
            <p className="font-medium truncate">{getProductDisplayName(activeDragProduct)}</p>
            <p className="text-[10px] text-muted-foreground">{activeDragProduct.product_code}</p>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
};

export default AgentQuoteBuilder;
