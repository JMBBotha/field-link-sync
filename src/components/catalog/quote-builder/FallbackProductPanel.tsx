import { useState, useMemo } from "react";
import { useDraggable } from "@dnd-kit/core";
import { computeProductPricing } from "@/lib/pricing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Search, Plus, GripVertical, Check, ShoppingBag } from "lucide-react";
import type { PaletteProduct, Basket } from "../QuoteBuilderTab";

interface FallbackProductPanelProps {
  products: PaletteProduct[];
  supplierId: string | null;
  supplierName?: string;
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
  const [zonePickerOpen, setZonePickerOpen] = useState(false);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `fallback-${product.id}`,
    data: { product },
  });

  const price = computeProductPricing(product).sellExVat;

  return (
    <div
      ref={setNodeRef}
      className={`flex items-center gap-2 px-2 py-1.5 rounded-md border transition-all ${
        isDragging
          ? "opacity-40 border-primary/40 scale-95"
          : inQuoteQty > 0
            ? "border-primary/20 bg-primary/5"
            : "border-transparent hover:border-border hover:bg-muted/40"
      }`}
    >
      <div
        {...listeners}
        {...attributes}
        className="cursor-grab active:cursor-grabbing shrink-0 touch-none p-0.5 rounded hover:bg-muted"
        style={{ touchAction: "none" }}
      >
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/60" />
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
      <div className="shrink-0" data-no-dnd="true">
        <Popover open={zonePickerOpen} onOpenChange={setZonePickerOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onPointerDown={(e) => { e.stopPropagation(); }}
              onMouseDown={(e) => { e.stopPropagation(); }}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent side="left" align="start" className="w-40 p-1">
            <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1">
              Add to zone
            </p>
            {baskets.length === 0 ? (
              <p className="text-[10px] text-muted-foreground px-2 py-2">No zones yet</p>
            ) : (
              baskets.map((b) => (
                <Button
                  key={b.id}
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-xs h-7 gap-1.5"
                  onClick={() => {
                    onAddProductToBasket(b.id, product);
                    setZonePickerOpen(false);
                  }}
                >
                  <ShoppingBag className="h-3 w-3" />{b.name}
                </Button>
              ))
            )}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
};

const FallbackProductPanel = ({
  products,
  supplierId,
  supplierName,
  baskets,
  onAddProductToBasket,
  basketProductCounts,
}: FallbackProductPanelProps) => {
  const [search, setSearch] = useState("");

  const supplierProducts = useMemo(() => {
    if (!supplierId) return products;
    return products.filter((p) => {
      // Match by supplier_name (from join) containing supplierId or matching name
      const sName = (p.supplier_name || "").toLowerCase();
      const sId = supplierId.toLowerCase();
      return sName === sId || sName.includes(sId) || sId.includes(sName);
    });
  }, [products, supplierId]);

  const filtered = useMemo(() => {
    let list = supplierProducts;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.product_code.toLowerCase().includes(q) ||
          (p.short_name || "").toLowerCase().includes(q) ||
          (p.brand || "").toLowerCase().includes(q)
      );
    }
    return list.slice(0, 100);
  }, [supplierProducts, search]);

  return (
    <div className="flex flex-col h-full border-l bg-background w-[240px] shrink-0">
      <div className="px-2 py-1.5 border-b bg-white">
        {supplierName && (
          <Badge variant="outline" className="text-[9px] mb-1 w-full justify-center truncate">
            {supplierProducts.length} products for {supplierName}
          </Badge>
        )}
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
          {supplierProducts.length === 0 ? (
            <div className="text-center py-6 px-2">
              <p className="text-[11px] font-medium text-muted-foreground">No products imported</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {supplierName ? `Import products for ${supplierName} first.` : "Import products first."}
              </p>
            </div>
          ) : filtered.length === 0 ? (
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
      <div className="px-2 py-1 border-t bg-white">
        <p className="text-[9px] text-muted-foreground text-center">
          {filtered.length} products · Drag to zone or click +
        </p>
      </div>
    </div>
  );
};

export default FallbackProductPanel;
