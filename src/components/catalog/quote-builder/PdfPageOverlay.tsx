import { useState, memo, useCallback } from "react";
import { useDraggable } from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import { Check, ShoppingCart, Plus, AlertCircle } from "lucide-react";
import type { PaletteProduct, Basket } from "../QuoteBuilderTab";

export interface OverlayRegion {
  id: string;
  x_pct: number;
  y_pct: number;
  w_pct: number;
  h_pct: number;
  product: PaletteProduct | null;
  product_code: string;
  label: string;
}

interface PdfPageOverlayProps {
  regions: OverlayRegion[];
  baskets: Basket[];
  onAddProductToBasket: (basketId: string, product: PaletteProduct) => void;
  basketProductCounts: Record<string, number>;
}

const DraggableRegion = memo(({
  region,
  baskets,
  onAddProductToBasket,
  inQuoteQty,
}: {
  region: OverlayRegion;
  baskets: Basket[];
  onAddProductToBasket: (basketId: string, product: PaletteProduct) => void;
  inQuoteQty: number;
}) => {
  const [showActions, setShowActions] = useState(false);
  const product = region.product;
  const isMatched = !!product;

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `pdf-overlay-${region.id}`,
    data: { product },
    disabled: !isMatched,
  });

  const price = product?.selling_price || product?.cost_incl_vat || 0;

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!isMatched) return;
    e.stopPropagation();
    setShowActions((prev) => !prev);
  }, [isMatched]);

  const handleAddToZone = useCallback((basketId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (product) {
      onAddProductToBasket(basketId, product);
      setShowActions(false);
    }
  }, [product, onAddProductToBasket]);

  return (
    <div
      ref={setNodeRef}
      {...(isMatched ? { ...listeners, ...attributes } : {})}
      className={`absolute transition-all duration-150 cursor-pointer group ${
        isDragging ? "opacity-40 ring-2 ring-primary" : ""
      } ${
        isMatched
          ? "border border-transparent hover:border-blue-400/60 hover:bg-blue-500/10 hover:shadow-[0_0_12px_rgba(59,130,246,0.25)]"
          : "border border-transparent hover:border-dashed hover:border-muted-foreground/40 hover:bg-muted/10"
      }`}
      style={{
        left: `${region.x_pct}%`,
        top: `${region.y_pct}%`,
        width: `${region.w_pct}%`,
        height: `${region.h_pct}%`,
        touchAction: isMatched ? "none" : "auto",
        minHeight: "14px",
        minWidth: "16px",
      }}
      onClick={handleClick}
    >
      {/* Corner indicator badge */}
      {isMatched && (
        <div className="absolute -top-1.5 -right-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          {inQuoteQty > 0 ? (
            <div className="h-4 w-4 rounded-full bg-blue-500 flex items-center justify-center shadow-sm">
              <Check className="h-2.5 w-2.5 text-white" />
            </div>
          ) : (
            <div className="h-4 w-4 rounded-full bg-green-500 flex items-center justify-center shadow-sm">
              <ShoppingCart className="h-2.5 w-2.5 text-white" />
            </div>
          )}
        </div>
      )}

      {/* Unmatched indicator */}
      {!isMatched && (
        <div className="absolute -top-1.5 -right-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          <div className="h-4 w-4 rounded-full bg-muted border border-dashed border-muted-foreground/50 flex items-center justify-center">
            <AlertCircle className="h-2.5 w-2.5 text-muted-foreground" />
          </div>
        </div>
      )}

      {/* Hover tooltip — positioned above the region */}
      <div className="absolute left-0 bottom-full mb-1.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
        <div className="bg-popover border rounded-lg shadow-xl px-3 py-2 text-[10px] whitespace-nowrap max-w-[280px]">
          {isMatched && product ? (
            <div className="space-y-0.5">
              <p className="font-semibold text-foreground text-[11px] truncate">
                {product.short_name || product.product_code}
              </p>
              <p className="font-mono text-primary/80">{product.product_code}</p>
              <div className="flex items-center gap-2">
                <span className="font-bold text-foreground">
                  R{price.toLocaleString("en-ZA")}
                </span>
                {product.sold_in_length && product.price_per_metre && (
                  <span className="text-orange-600 font-medium">
                    R{product.price_per_metre.toFixed(2)}/m
                  </span>
                )}
              </div>
              {product.brand && (
                <p className="text-muted-foreground">{product.brand}</p>
              )}
              {inQuoteQty > 0 && (
                <p className="text-blue-600 font-medium">In quote: ×{inQuoteQty}</p>
              )}
              <p className="text-muted-foreground/60 text-[9px] mt-0.5">
                Drag to zone or click for options
              </p>
            </div>
          ) : (
            <div>
              <p className="text-muted-foreground italic">Not in catalog</p>
              <p className="text-muted-foreground/60 text-[9px] truncate max-w-[200px]">
                {region.label || region.product_code}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Click action popover */}
      {showActions && isMatched && product && baskets.length > 0 && (
        <div
          className="absolute left-0 top-full mt-1.5 z-50 bg-popover border rounded-lg shadow-xl p-1.5 min-w-[150px]"
          data-no-dnd="true"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-0.5">
            Add to zone
          </p>
          {baskets.map((basket) => (
            <Button
              key={basket.id}
              variant="ghost"
              size="sm"
              className="w-full justify-start text-xs h-7 gap-1.5"
              onClick={(e) => handleAddToZone(basket.id, e)}
            >
              <Plus className="h-3 w-3" />
              {basket.name}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
});

DraggableRegion.displayName = "DraggableRegion";

const PdfPageOverlay = ({
  regions,
  baskets,
  onAddProductToBasket,
  basketProductCounts,
}: PdfPageOverlayProps) => {
  // Only render regions with valid coordinate data
  const positionedRegions = regions.filter(
    (r) =>
      r.x_pct != null &&
      r.y_pct != null &&
      r.w_pct != null &&
      r.h_pct != null &&
      (r.w_pct > 0 || r.h_pct > 0)
  );

  if (positionedRegions.length === 0) return null;

  return (
    <>
      {positionedRegions.map((region) => (
        <DraggableRegion
          key={region.id}
          region={region}
          baskets={baskets}
          onAddProductToBasket={onAddProductToBasket}
          inQuoteQty={
            region.product
              ? basketProductCounts[region.product.id] || 0
              : 0
          }
        />
      ))}
    </>
  );
};

export default PdfPageOverlay;
