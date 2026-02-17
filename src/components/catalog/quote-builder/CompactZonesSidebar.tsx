import { memo, useMemo } from "react";
import { Plus, Trash2, ShoppingBag, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import type { Basket } from "../QuoteBuilderTab";

interface CompactZonesSidebarProps {
  baskets: Basket[];
  onAddBasket: () => void;
  onRemoveBasket: (id: string) => void;
}

const CompactZonesSidebar = memo(({ baskets, onAddBasket, onRemoveBasket }: CompactZonesSidebarProps) => {
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

  const totalItems = baskets.reduce((s, b) => s + b.items.length, 0);

  return (
    <div className="flex flex-col h-full border-r bg-background w-full">
      {/* Header */}
      <div className="px-3 py-2 border-b bg-muted/20 shrink-0">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-foreground">Quote Zones</h3>
          <Button variant="outline" size="sm" className="h-6 text-[10px] gap-0.5 px-1.5" onClick={onAddBasket}>
            <Plus className="h-2.5 w-2.5" />Zone
          </Button>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] text-muted-foreground">{baskets.length} zones · {totalItems} items</span>
          <span className="text-[10px] font-bold text-foreground">
            R{totalCost.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}
          </span>
        </div>
      </div>

      {/* Zone list */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1.5">
          {baskets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Package className="h-6 w-6 mb-2 opacity-30" />
              <p className="text-[10px]">No zones yet</p>
            </div>
          ) : (
            baskets.map((basket) => {
              const subtotal = basket.items.reduce((s, i) => {
                if (i.product.sold_in_length && i.product.price_per_metre && i.length) {
                  return s + i.product.price_per_metre * i.length;
                }
                return s + (i.product.selling_price || i.product.cost_incl_vat || 0) * i.quantity;
              }, 0);
              const totalQty = basket.items.reduce((s, i) => s + i.quantity, 0);

              return (
                <div
                  key={basket.id}
                  className="rounded-lg border bg-card p-2 hover:border-primary/20 transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <ShoppingBag className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="text-[11px] font-semibold truncate flex-1">{basket.name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-4 w-4 text-destructive/60 hover:text-destructive shrink-0"
                      onClick={() => onRemoveBasket(basket.id)}
                    >
                      <Trash2 className="h-2.5 w-2.5" />
                    </Button>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[9px] text-muted-foreground">
                      {basket.items.length} items · {totalQty} qty
                    </span>
                    <span className="text-[10px] font-bold">
                      R{subtotal.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                  {/* Compact item list */}
                  {basket.items.length > 0 && (
                    <div className="mt-1.5 space-y-0.5 border-t pt-1">
                      {basket.items.slice(0, 5).map((item) => (
                        <div key={item.instanceId} className="flex items-center justify-between text-[9px]">
                          <span className="truncate text-muted-foreground flex-1 mr-1">
                            {item.product.short_name || item.product.product_code}
                          </span>
                          <span className="shrink-0 font-medium">×{item.quantity}</span>
                        </div>
                      ))}
                      {basket.items.length > 5 && (
                        <p className="text-[8px] text-muted-foreground">+{basket.items.length - 5} more...</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
});

CompactZonesSidebar.displayName = "CompactZonesSidebar";

export default CompactZonesSidebar;
