import { useState, useMemo, useCallback, useRef } from "react";
import { useDraggable } from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, GripVertical, Check } from "lucide-react";
import type { PaletteProduct, Basket } from "../QuoteBuilderTab";

interface FallbackProductPanelProps {
  products: PaletteProduct[];
  supplierId: string | null;
  baskets: Basket[];
  onAddProductToBasket: (basketId: string, product: PaletteProduct) => void;
  basketProductCounts: Record<string, number>;
}

const DraggableProductRow = ({
  product,
  baskets,
  onAddProductToBasket,
  inQuoteQty,
}: {
  product: PaletteProduct;
  baskets: Basket[];
  onAddProductToBasket: (basketId: string, product: PaletteProduct) => void;
  inQuoteQty: number;
}) => {
  const [showZones, setShowZones] = useState(false);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `fallback-${product.id}`,
    data: { product },
  });

  const price = product.selling_price || product.cost_incl_vat || 0;

  return (
    <div
      ref={setNodeRef}
      className={`flex items-center gap-2 px-2 py-1.5 rounded-md border border-transparent hover:border-border hover:bg-muted/40 transition-colors ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <div {...listeners} {...attributes} className="cursor-grab shrink-0 touch-none">
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-medium truncate text-foreground">
          {product.short_name || product.product_code}
        </p>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono text-muted-foreground">{product.product_code}</span>
          <span className="text-[10px] font-semibold text-foreground">R{price.toLocaleString("en-ZA")}</span>
          {inQuoteQty > 0 && (
            <Badge variant="secondary" className="h-4 text-[9px] px-1">
              <Check className="h-2.5 w-2.5 mr-0.5" />×{inQuoteQty}
            </Badge>
          )}
        </div>
      </div>
      <div className="relative shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={(e) => { e.stopPropagation(); setShowZones(!showZones); }}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
        {showZones && baskets.length > 0 && (
          <div className="absolute right-0 top-full mt-1 z-50 bg-popover border rounded-lg shadow-xl p-1 min-w-[130px]">
            <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-0.5">Add to zone</p>
            {baskets.map((b) => (
              <Button
                key={b.id}
                variant="ghost"
                size="sm"
                className="w-full justify-start text-xs h-7 gap-1.5"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddProductToBasket(b.id, product);
                  setShowZones(false);
                }}
              >
                <Plus className="h-3 w-3" />{b.name}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const FallbackProductPanel = ({
  products,
  supplierId,
  baskets,
  onAddProductToBasket,
  basketProductCounts,
}: FallbackProductPanelProps) => {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    let list = products;
    if (supplierId) {
      // Filter would need supplier_id on PaletteProduct — for now show all since products are already filtered by supplier in many cases
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.product_code.toLowerCase().includes(q) ||
          (p.short_name || "").toLowerCase().includes(q) ||
          (p.brand || "").toLowerCase().includes(q)
      );
    }
    return list.slice(0, 100); // limit for perf
  }, [products, supplierId, search]);

  return (
    <div className="flex flex-col h-full border-l bg-background w-[240px] shrink-0">
      <div className="px-2 py-1.5 border-b bg-muted/20">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
          Supplier Products
        </p>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products…"
            className="h-7 text-[11px] pl-7"
          />
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-1 space-y-0.5">
          {filtered.length === 0 ? (
            <p className="text-[10px] text-muted-foreground text-center py-4">No products found</p>
          ) : (
            filtered.map((p) => (
              <DraggableProductRow
                key={p.id}
                product={p}
                baskets={baskets}
                onAddProductToBasket={onAddProductToBasket}
                inQuoteQty={basketProductCounts[p.id] || 0}
              />
            ))
          )}
        </div>
      </ScrollArea>
      <div className="px-2 py-1 border-t">
        <p className="text-[9px] text-muted-foreground text-center">
          {filtered.length} products · Drag to zone
        </p>
      </div>
    </div>
  );
};

export default FallbackProductPanel;
