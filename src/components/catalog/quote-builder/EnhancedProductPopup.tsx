import { useState, useMemo, useCallback, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { Plus, Minus, Star, ShoppingBag, X, ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getCategoryIcon, getCategoryBg } from "./ProductPalette";
import { getProductDisplayName } from "./productDisplayUtils";
import { calcSellingPrice } from "@/utils/pricing";
import type { PaletteProduct, Basket } from "../QuoteBuilderTab";

function getProductPricing(product: PaletteProduct) {
  const cost = product.cost_price || product.cost_excl_vat || 0;
  const markup = product.default_markup_percent ?? product.markup_percent ?? 20;
  if (cost <= 0) {
    const fallbackPrice = product.cost_incl_vat || product.selling_price || 0;
    return { costExclVat: 0, discountedCost: 0, markupPercent: markup, sellingPrice: fallbackPrice, sellingPriceInclVat: fallbackPrice, supplierDiscountPercent: 0 };
  }
  const { sellingExclVat, sellingInclVat } = calcSellingPrice(cost, markup);
  const safe = (n: number) => (isFinite(n) && !isNaN(n) ? n : 0);
  return { costExclVat: cost, discountedCost: cost, markupPercent: markup, sellingPrice: safe(sellingExclVat), sellingPriceInclVat: safe(sellingInclVat), supplierDiscountPercent: 0 };
}

interface EnhancedProductPopupProps {
  product: PaletteProduct;
  baskets?: Basket[];
  onAddProductToBasket?: (basketId: string, product: PaletteProduct) => void;
  onAddBasket?: () => void;
  onClose?: () => void;
  basketProductCounts?: Record<string, number>;
  /** Pass the mouse event that triggered this popup for cursor-relative positioning */
  mouseEvent?: { clientX: number; clientY: number } | null;
  /** When true, renders as a lightweight pointer-events-none hover card (no backdrop/zones) */
  isHoverMode?: boolean;
  /** Controls visibility in hover mode */
  isVisible?: boolean;
}

const OFFSET = 14;
const EDGE_MARGIN = 16;

const EnhancedProductPopup = ({
  product,
  baskets = [],
  onAddProductToBasket,
  onAddBasket,
  onClose,
  basketProductCounts = {},
  mouseEvent,
  isHoverMode = false,
  isVisible = true,
}: EnhancedProductPopupProps) => {
  const safeNum = (n: number) => (isFinite(n) && !isNaN(n) ? n : 0);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [markupOverride, setMarkupOverride] = useState<number | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const effectiveMarkup = markupOverride ?? product.markup_percent ?? 20;
  const pricing = useMemo(() => getProductPricing({ ...product, markup_percent: effectiveMarkup }), [product, effectiveMarkup]);
  const price = pricing.sellingPrice || product.cost_incl_vat || 0;
  const inQuoteQty = basketProductCounts[product.id] || 0;

  // Position near cursor, clamped to viewport
  useLayoutEffect(() => {
    if (!popupRef.current) return;
    if (isHoverMode && !isVisible) return;

    const rect = popupRef.current.getBoundingClientRect();
    const pw = rect.width || 340;
    const ph = rect.height || 200;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let cx = vw / 2;
    let cy = vh / 2;
    if (mouseEvent) {
      cx = mouseEvent.clientX;
      cy = mouseEvent.clientY;
    }

    let x = cx + OFFSET;
    let y = cy + OFFSET;

    if (x + pw > vw - EDGE_MARGIN) x = cx - pw - OFFSET;
    if (y + ph > vh - EDGE_MARGIN) y = cy - ph - OFFSET;
    x = Math.max(EDGE_MARGIN, Math.min(x, vw - pw - EDGE_MARGIN));
    y = Math.max(EDGE_MARGIN, Math.min(y, vh - ph - EDGE_MARGIN));

    setPos({ top: y, left: x });
  }, [mouseEvent, isHoverMode, isVisible]);

  const handleSetQty = useCallback((basketId: string, qty: number) => {
    setQuantities((prev) => ({ ...prev, [basketId]: Math.max(0, qty) }));
  }, []);

  const handleAddAll = useCallback(() => {
    Object.entries(quantities).forEach(([basketId, qty]) => {
      for (let i = 0; i < qty; i++) {
        onAddProductToBasket?.(basketId, product);
      }
    });
    onClose?.();
  }, [quantities, onAddProductToBasket, product, onClose]);

  const handleQuickAdd = useCallback((basketId: string) => {
    onAddProductToBasket?.(basketId, product);
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

  // ── Hover mode: lightweight info card, portaled, pointer-events-none ──
  if (isHoverMode) {
    if (!isVisible) return null;

    const content = (
      <div
        ref={popupRef}
        className="fixed pointer-events-none z-[9999] bg-popover border rounded-xl shadow-2xl w-[340px] max-w-[90vw] p-4 animate-in fade-in zoom-in-95 duration-150"
        style={{ top: `${pos.top}px`, left: `${pos.left}px` }}
      >
        <div className="space-y-1.5">
          <div className="flex items-start gap-2">
            <div className={`shrink-0 rounded-lg p-1.5 ${getCategoryBg(product.product_category)}`}>
              {getCategoryIcon(product.product_category, "h-4 w-4")}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">
                {getProductDisplayName(product)}
              </p>
              <p className="text-xs font-mono text-primary/80">{product.product_code}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-foreground">
              R{safeNum(price).toLocaleString("en-ZA")}
            </span>
            {product.sold_in_length && product.price_per_metre && (
              <span className="text-[10px] text-orange-600 font-medium border border-orange-400/40 rounded px-1">
                R{product.price_per_metre.toFixed(2)}/m
              </span>
            )}
          </div>
          {/* Markup display */}
          {(product.cost_price || product.cost_excl_vat || 0) > 0 && (() => {
            const p = getProductPricing(product);
            return (
              <div className="flex items-center gap-2 text-[10px]">
                <span className="text-muted-foreground">Cost: <span className="font-mono font-medium text-foreground">R{safeNum(p.discountedCost).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
                <span className="text-muted-foreground">M/Up: <span className="font-mono font-semibold text-primary">{p.markupPercent.toFixed(1)}%</span></span>
              </div>
            );
          })()}
          {product.brand && (
            <p className="text-xs text-muted-foreground">{product.brand}</p>
          )}
          {inQuoteQty > 0 && (
            <p className="text-xs font-medium text-primary">
              In quote: ×{inQuoteQty}
            </p>
          )}
          <p className="text-[9px] text-muted-foreground/50 mt-1">Click row to add to quote</p>
        </div>
      </div>
    );

    return createPortal(content, document.body);
  }

  // ── Click mode: full interactive popup with backdrop & zones ──
  return (
    <div
      className="fixed inset-0 z-[60]"
      onClick={onClose}
    >
      <div
        ref={popupRef}
        className="fixed z-[9999] bg-popover border rounded-xl shadow-2xl w-[420px] max-w-[95vw] max-h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        style={{ top: `${pos.top}px`, left: `${pos.left}px` }}
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
                R{safeNum(price).toLocaleString("en-ZA")}
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
            {/* Markup row with +/- controls */}
            {(product.cost_price || product.cost_excl_vat || 0) > 0 && (() => {
              const p = getProductPricing(product);
              return (
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-[10px] text-muted-foreground">Cost: <span className="font-mono font-medium text-foreground">R{safeNum(p.discountedCost).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
                <span className="text-[10px] text-muted-foreground">M/Up:</span>
                <div className="flex items-center gap-0.5">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-5 w-5"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMarkupOverride(Math.max(0, effectiveMarkup - 5));
                    }}
                  >
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                  <span className="text-[11px] font-mono font-semibold text-primary min-w-[40px] text-center">
                    {pricing.markupPercent.toFixed(1)}%
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-5 w-5"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMarkupOverride(effectiveMarkup + 5);
                    }}
                  >
                    <ChevronUp className="h-3 w-3" />
                  </Button>
                </div>
                <span className="text-[10px] font-mono text-foreground ml-auto">
                  → R{safeNum(pricing.sellingPrice).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              );
            })()}
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
                        {basket.items.length} items · R{safeNum(zoneTotal).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}
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
              onAddBasket?.();
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
