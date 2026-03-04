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
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useDroppable } from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Trash2, Package, ShoppingBag, GripVertical, Pencil, Check, Copy, Minimize2, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SharedBasketItemCard } from "@/components/shared/SharedBasketItems";
import QuoteSummaryPanel from "@/components/catalog/quote-builder/QuoteSummaryPanel";
import ConsumablesSuggestionPanel from "@/components/catalog/quote-builder/ConsumablesSuggestionPanel";
import ZoneTemplateSelector from "@/components/catalog/quote-builder/ZoneTemplateSelector";
import type { PaletteProduct, BasketItem, Basket } from "@/components/catalog/QuoteBuilderTab";
import { getProductDisplayName } from "@/components/catalog/quote-builder/productDisplayUtils";
import { getCategoryIcon, getCategoryBg } from "@/components/catalog/quote-builder/ProductPalette";
import { getEffectiveUnitPrices } from "@/components/catalog/QuoteBuilderTab";
import { calculateBasketSubtotal } from "@/utils/basketCalc";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

/* ─── Draggable product card for agent palette ─── */
function AgentDraggableProduct({ product }: { product: PaletteProduct }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `product-${product.id}`,
    data: { product, type: "palette" },
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

/* ─── Sortable item wrapper ─── */
function SortableBasketItem({
  item,
  isCompact,
  onRemove,
  onUpdateQuantity,
  onUpdateLength,
}: {
  item: BasketItem;
  isCompact?: boolean;
  onRemove: () => void;
  onUpdateQuantity: (qty: number) => void;
  onUpdateLength: (len: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.instanceId,
    data: { type: "sortable-item", basketItem: item },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <div className="flex items-center gap-0.5">
        <div {...listeners} className="cursor-grab active:cursor-grabbing shrink-0 p-0.5 touch-none">
          <GripVertical className="h-3 w-3 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <SharedBasketItemCard
            item={item}
            isCompact={isCompact}
            onRemove={onRemove}
            onUpdateQuantity={onUpdateQuantity}
            onUpdateLength={onUpdateLength}
          />
        </div>
      </div>
    </div>
  );
}

/* ─── Droppable zone for agent (with sortable + rename + duplicate + consumables) ─── */
function AgentDroppableZone({
  basket,
  allProducts,
  onRemoveItem,
  onUpdateQuantity,
  onUpdateLength,
  onRemoveBasket,
  onDuplicateBasket,
  onRenameBasket,
  onAddProduct,
  onReorderItems,
  isDragActive,
  isCompact,
}: {
  basket: Basket;
  allProducts: PaletteProduct[];
  onRemoveItem: (instanceId: string) => void;
  onUpdateQuantity: (instanceId: string, qty: number) => void;
  onUpdateLength: (instanceId: string, len: number) => void;
  onRemoveBasket: () => void;
  onDuplicateBasket: () => void;
  onRenameBasket: (name: string) => void;
  onAddProduct: (product: PaletteProduct) => void;
  onReorderItems: (oldIndex: number, newIndex: number) => void;
  isDragActive: boolean;
  isCompact?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: basket.id });
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(basket.name);

  const subtotal = calculateBasketSubtotal(basket.items);
  const totalQty = basket.items.reduce((s, i) => s + i.quantity, 0);
  const itemIds = useMemo(() => basket.items.map((i) => i.instanceId), [basket.items]);

  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border-2 border-dashed transition-all duration-200 ${
        isOver
          ? "border-primary bg-primary/10 shadow-lg ring-2 ring-primary/20"
          : isDragActive
            ? "border-primary/40 bg-primary/5"
            : "border-border bg-card"
      }`}
    >
      {/* Zone header with rename, duplicate, delete */}
      <div className={`flex items-center justify-between border-b border-border/50 ${isCompact ? "px-1.5 py-1" : "p-2.5"}`}>
        {editing ? (
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="h-5 text-[10px] w-20 px-1"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onRenameBasket(editName);
                  setEditing(false);
                }
              }}
            />
            <Button variant="ghost" size="icon" className="h-5 w-5"
              onClick={() => { onRenameBasket(editName); setEditing(false); }}>
              <Check className="h-2.5 w-2.5" />
            </Button>
          </div>
        ) : (
          <button
            className={`flex items-center gap-1 font-semibold text-foreground hover:text-primary transition-colors truncate min-w-0 ${isCompact ? "text-[10px]" : "text-xs"}`}
            onClick={() => setEditing(true)}
          >
            <ShoppingBag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{basket.name}</span>
            <Pencil className="h-2 w-2 shrink-0 text-muted-foreground" />
          </button>
        )}
        <div className="flex items-center gap-0.5 shrink-0">
          <span className={`text-muted-foreground whitespace-nowrap ${isCompact ? "text-[8px]" : "text-[10px]"}`}>
            {basket.items.length}·{totalQty}
          </span>
          <span className={`font-bold text-foreground whitespace-nowrap ${isCompact ? "text-[10px]" : "text-xs"}`}>
            R{subtotal.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </span>
          <Button variant="ghost" size="icon" className="h-4 w-4 text-muted-foreground hover:text-foreground" onClick={onDuplicateBasket} title="Duplicate zone">
            <Copy className="h-2.5 w-2.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-4 w-4 text-destructive/60 hover:text-destructive" onClick={onRemoveBasket}>
            <Trash2 className="h-2.5 w-2.5" />
          </Button>
        </div>
      </div>

      {/* Items with sortable reordering */}
      <div className={`space-y-1 ${isCompact ? "p-1" : "p-2"}`} style={{ minHeight: isCompact ? 60 : 80 }}>
        {basket.items.length === 0 ? (
          <div className={`flex flex-col items-center justify-center py-4 rounded-md transition-colors ${
            isOver ? "bg-primary/10 text-primary" : isDragActive ? "bg-muted/50 text-muted-foreground" : "text-muted-foreground"
          }`}>
            <Package className="h-5 w-5 mb-1 opacity-40" />
            <p className="text-xs">{isOver ? "Release to drop" : "Drag products here"}</p>
          </div>
        ) : (
          <>
            <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
              {basket.items.map((item) => (
                <SortableBasketItem
                  key={item.instanceId}
                  item={item}
                  isCompact={isCompact}
                  onRemove={() => onRemoveItem(item.instanceId)}
                  onUpdateQuantity={(qty) => onUpdateQuantity(item.instanceId, qty)}
                  onUpdateLength={(len) => onUpdateLength(item.instanceId, len)}
                />
              ))}
            </SortableContext>
            {!isCompact && (
              <ConsumablesSuggestionPanel
                basketItems={basket.items}
                allProducts={allProducts}
                onAddProduct={onAddProduct}
              />
            )}
          </>
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
  const [activeSortItem, setActiveSortItem] = useState<BasketItem | null>(null);
  const [search, setSearch] = useState("");
  const [isCompact, setIsCompact] = useState(false);

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
    const data = e.active.data?.current as any;
    if (data?.type === "palette") {
      setActiveDragProduct(data.product || null);
      setActiveSortItem(null);
    } else if (data?.type === "sortable-item") {
      setActiveSortItem(data.basketItem || null);
      setActiveDragProduct(null);
    }
  }, []);

  const handleDragEnd = useCallback((e: DragEndEvent) => {
    const data = e.active.data?.current as any;

    // Handle sortable reorder within zone
    if (data?.type === "sortable-item") {
      const activeId = e.active.id as string;
      const overId = e.over?.id as string | undefined;
      if (activeId && overId && activeId !== overId) {
        setBaskets((prev) =>
          prev.map((b) => {
            const oldIndex = b.items.findIndex((i) => i.instanceId === activeId);
            const newIndex = b.items.findIndex((i) => i.instanceId === overId);
            if (oldIndex === -1 || newIndex === -1) return b;
            return { ...b, items: arrayMove(b.items, oldIndex, newIndex) };
          })
        );
      }
      setActiveSortItem(null);
      setActiveDragProduct(null);
      return;
    }

    // Handle palette → zone drop
    setActiveDragProduct(null);
    setActiveSortItem(null);
    const product = data?.product as PaletteProduct | undefined;
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

  const duplicateBasket = (id: string) => {
    setBaskets((prev) => {
      const source = prev.find((b) => b.id === id);
      if (!source) return prev;
      const newBasket: Basket = {
        id: `agent-zone-${Date.now()}`,
        name: `${source.name} (copy)`,
        items: source.items.map((i) => ({ ...i, instanceId: `${i.product.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` })),
      };
      const idx = prev.findIndex((b) => b.id === id);
      const next = [...prev];
      next.splice(idx + 1, 0, newBasket);
      return next;
    });
  };

  const renameBasket = (id: string, name: string) =>
    setBaskets((prev) => prev.map((b) => (b.id === id ? { ...b, name } : b)));

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

  const addProductToBasket = (basketId: string, product: PaletteProduct) => {
    setBaskets((prev) =>
      prev.map((b) =>
        b.id === basketId
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
  };

  const applyTemplate = (zones: string[]) => {
    const newBaskets: Basket[] = zones.map((name, i) => ({
      id: `agent-zone-${Date.now()}-${i}`,
      name,
      items: [],
    }));
    setBaskets(newBaskets);
  };

  const clearAll = () => setBaskets([]);

  const reorderItems = (basketId: string, oldIndex: number, newIndex: number) => {
    setBaskets((prev) =>
      prev.map((b) =>
        b.id === basketId ? { ...b, items: arrayMove(b.items, oldIndex, newIndex) } : b
      )
    );
  };

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
            <div className="flex items-center gap-1">
              {baskets.length > 0 && (
                <Button variant="ghost" size="sm" className="gap-0.5 text-destructive hover:text-destructive h-7 text-xs" onClick={clearAll}>
                  <Trash2 className="h-3 w-3" /> Clear All
                </Button>
              )}
              <ZoneTemplateSelector onApplyTemplate={applyTemplate} />
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setIsCompact((c) => !c)}
                title={isCompact ? "Expand" : "Compact"}
              >
                {isCompact ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
              </Button>
              <Button variant="outline" size="sm" className="gap-1 h-7 text-xs" onClick={addZone}>
                <Plus className="h-3 w-3" /> Add Zone
              </Button>
            </div>
          </div>
          <ScrollArea className="flex-1">
            <div className={`${isCompact ? "p-1.5 space-y-1.5" : "p-3 space-y-3"}`}>
              {baskets.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-muted-foreground py-12">
                  <Package className="h-8 w-8 mb-2 opacity-30" />
                  <p className="text-sm">No zones yet</p>
                  <p className="text-xs">Click "Add Zone" or use a template</p>
                </div>
              ) : (
                baskets.map((basket) => (
                  <AgentDroppableZone
                    key={basket.id}
                    basket={basket}
                    allProducts={products}
                    onRemoveItem={(iid) => removeItem(basket.id, iid)}
                    onUpdateQuantity={(iid, qty) => updateQuantity(basket.id, iid, qty)}
                    onUpdateLength={(iid, len) => updateLength(basket.id, iid, len)}
                    onRemoveBasket={() => removeBasket(basket.id)}
                    onDuplicateBasket={() => duplicateBasket(basket.id)}
                    onRenameBasket={(name) => renameBasket(basket.id, name)}
                    onAddProduct={(p) => addProductToBasket(basket.id, p)}
                    onReorderItems={(o, n) => reorderItems(basket.id, o, n)}
                    isDragActive={!!activeDragProduct}
                    isCompact={isCompact}
                  />
                ))
              )}
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
        {activeSortItem && (
          <div className="rounded-md border bg-card p-2 shadow-xl text-xs opacity-90 max-w-[200px]">
            <p className="font-medium truncate">{getProductDisplayName(activeSortItem.product)}</p>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
};

export default AgentQuoteBuilder;
