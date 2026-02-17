import { useState, memo, useCallback } from "react";
import { useDraggable } from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import { ShoppingCart } from "lucide-react";
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
  onProductClick?: (product: PaletteProduct) => void;
}

const DraggableRegion = memo(({
  region,
  baskets,
  onAddProductToBasket,
  inQuoteQty,
  onProductClick,
}: {
  region: OverlayRegion;
  baskets: Basket[];
  onAddProductToBasket: (basketId: string, product: PaletteProduct) => void;
  inQuoteQty: number;
  onProductClick?: (product: PaletteProduct) => void;
}) => {
  const product = region.product;
  const isMatched = !!product;
  const isFavorite = product?.is_pinned === true;

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `pdf-overlay-${region.id}`,
    data: { product },
    disabled: !isMatched,
  });

  const price = product?.selling_price || product?.cost_incl_vat || 0;

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!isMatched || !product) return;
    e.stopPropagation();
    if (onProductClick) {
      onProductClick(product);
    }
  }, [isMatched, product, onProductClick]);

  // Hide unmatched regions completely
  if (!isMatched) return null;

  return (
    <div
      ref={setNodeRef}
      {...{ ...listeners, ...attributes }}
      className={`absolute transition-all duration-150 cursor-pointer group ${
        isDragging ? "opacity-40 ring-2 ring-primary" : ""
      } ${
        inQuoteQty > 0
          ? "border-2 border-green-400/50 bg-green-500/5 hover:bg-green-500/15 hover:shadow-[0_0_12px_rgba(34,197,94,0.3)]"
          : "border border-blue-400/40 bg-blue-500/5 hover:border-blue-400/70 hover:bg-blue-500/15 hover:shadow-[0_0_12px_rgba(59,130,246,0.25)]"
      }`}
      style={{
        left: `${region.x_pct}%`,
        top: `${region.y_pct}%`,
        width: `${region.w_pct}%`,
        height: `${region.h_pct}%`,
        touchAction: "none",
        minHeight: "14px",
        minWidth: "16px",
        marginTop: "3px",
        marginBottom: "3px",
      }}
      onClick={handleClick}
    >
      {/* Corner indicator badge */}
      <div className="absolute -top-2 opacity-70 group-hover:opacity-100 transition-opacity z-10" style={{ right: "-20px" }}>
        {inQuoteQty > 0 ? (
          <div className="h-5 w-5 rounded-full bg-green-500 flex items-center justify-center shadow-sm text-[8px] font-bold text-white">
            {inQuoteQty}
          </div>
        ) : isFavorite ? (
          <div className="h-5 w-5 flex items-center justify-center relative">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-yellow-400 text-yellow-500 drop-shadow-sm absolute inset-0">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            <ShoppingCart className="h-2.5 w-2.5 text-white relative z-10" />
          </div>
        ) : (
          <div className="h-4 w-4 rounded-full bg-blue-500 flex items-center justify-center shadow-sm">
            <ShoppingCart className="h-2.5 w-2.5 text-white" />
          </div>
        )}
      </div>

      {/* Hover tooltip */}
      <div className="absolute left-0 bottom-full mb-1.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
        <div className="bg-popover border rounded-lg shadow-xl px-3 py-2 text-[10px] whitespace-nowrap max-w-[280px]">
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
            {isFavorite && (
              <p className="text-yellow-600 font-medium text-[9px]">★ Favorite</p>
            )}
            <p className="text-muted-foreground/60 text-[9px] mt-0.5">
              Click for full options · Drag to zone
            </p>
          </div>
        </div>
      </div>
    </div>
  );
});

DraggableRegion.displayName = "DraggableRegion";

const PdfPageOverlay = ({
  regions,
  baskets,
  onAddProductToBasket,
  basketProductCounts,
  onProductClick,
}: PdfPageOverlayProps) => {
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
          onProductClick={onProductClick}
        />
      ))}
    </>
  );
};

export default PdfPageOverlay;
