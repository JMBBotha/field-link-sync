import { useState, useMemo, useCallback } from "react";
import { Plus, Minus, Star, ShoppingBag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { getCategoryIcon, getCategoryBg } from "./ProductPalette";
import { getProductDisplayName } from "./productDisplayUtils";
import type { PaletteProduct, Basket } from "../QuoteBuilderTab";

interface EnhancedProductPopupProps {
  product: PaletteProduct;
  baskets: Basket[];
  onAddProductToBasket: (basketId: string, product: PaletteProduct) => void;
  onAddBasket: () => void;
  onClose: () => void;
  basketProductCounts: Record<string, number>;
}

const EnhancedProductPopup = ({
  product,
  baskets,
  onAddProductToBasket,
  onAddBasket,
  onClose,
  basketProductCounts,
}: EnhancedProductPopupProps) => {
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const price = product.selling_price || product.cost_incl_vat || 0;
  const inQuoteQty = basketProductCounts[product.id] || 0;

  const handleSetQty = useCallback((basketId: string, qty: number) => {
    setQuantities((prev) => ({ ...prev, [basketId]: Math.max(0, qty) }));
  }, []);

  const handleAddAll = useCallback(() => {
    Object.entries(quantities).forEach(([basketId, qty]) => {
      for (let i = 0; i < qty; i++) {
        onAddProductToBasket(basketId, product);
      }
    });
    onClose();
  }, [quantities, onAddProductToBasket, product, onClose]);

  const handleQuickAdd = useCallback((basketId: string) => {
    onAddProductToBasket(basketId, product);
  }, [onAddProductToBasket, product]);

  const zoneTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    baskets.forEach((b) => {
      totals[b.id] = b.items.reduce((s, i) => {
        if (i.product.sold_in_length && i.product.price_per_metre && i.length) {
          return s + i.product.price_per_metre * i.length;
        }
        return s + (i.product.selling_price || i.product.cost_incl_vat || 0) * i.quantity;
      }, 0);
    });
    return totals;
  }, [baskets]);

  const hasQuantities = Object.values(quantities).some((q) => q > 0);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-popover border rounded-xl shadow-2xl w-[420px] max-w-[95vw] max-h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
        data-no-dnd="true"
      >
        {/* Header */}
        <div className="flex items-start gap-3 p-4 border-b bg-muted/20">
          <div className={`shrink-0 rounded-lg p-2 ${getCategoryBg(product.product_category)}`}>
            {getCategoryIcon(product.product_category, "h-5 w-5")}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">
              {getProductDisplayName(product)}
            </p>
            <p className="text-xs font-mono text-primary/80 mt-0.5">{product.product_code}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm font-bold text-foreground">
                R{price.toLocaleString("en-ZA")}
              </span>
              {product.sold_in_length && product.price_per_metre && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 border-orange-400/40 text-orange-600">
                  R{product.price_per_metre.toFixed(2)}/m
                </Badge>
              )}
              {product.is_pinned && (
                <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-500" />
              )}
              {inQuoteQty > 0 && (
                <Badge variant="secondary" className="text-[9px]">
                  Already in quote: ×{inQuoteQty}
                </Badge>
              )}
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Zone list */}
        <ScrollArea className="flex-1" style={{ maxHeight: "calc(80vh - 180px)" }}>
          <div className="p-3 space-y-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Add to zones
            </p>
            {baskets.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No zones yet — create one below</p>
            ) : (
              baskets.map((basket) => {
                const qty = quantities[basket.id] || 0;
                const zoneTotal = zoneTotals[basket.id] || 0;
                return (
                  <div
                    key={basket.id}
                    className="flex items-center gap-2 rounded-lg border bg-background p-2.5 hover:border-primary/30 transition-colors"
                  >
                    <ShoppingBag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{basket.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {basket.items.length} items · R{zoneTotal.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => handleSetQty(basket.id, qty - 1)}
                        disabled={qty <= 0}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-6 text-center text-xs font-semibold">{qty}</span>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => handleSetQty(basket.id, qty + 1)}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px] px-2 ml-1"
                        onClick={() => handleQuickAdd(basket.id)}
                      >
                        +1
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="border-t p-3 bg-muted/10 flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1 text-xs"
            onClick={() => {
              onAddBasket();
            }}
          >
            <Plus className="h-3 w-3" />
            Add New Zone
          </Button>
          <div className="flex-1" />
          {hasQuantities && (
            <Button size="sm" className="gap-1 text-xs" onClick={handleAddAll}>
              Add to {Object.values(quantities).filter((q) => q > 0).length} zones
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default EnhancedProductPopup;
