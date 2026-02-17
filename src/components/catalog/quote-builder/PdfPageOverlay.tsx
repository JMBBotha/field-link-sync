import { useState, memo, useCallback } from "react";
import { useDraggable } from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import { ShoppingCart, Plus, X } from "lucide-react";
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
  has_price?: boolean;
  detected_price?: number | null;
  matched?: boolean;
}

interface PdfPageOverlayProps {
  regions: OverlayRegion[];
  baskets: Basket[];
  onAddProductToBasket: (basketId: string, product: PaletteProduct) => void;
  basketProductCounts: Record<string, number>;
  onProductClick?: (product: PaletteProduct) => void;
  onQuickAddProduct?: (label: string, productCode: string, price: number | null) => void;
}

/** Popup for unmatched items with price data */
const UnmatchedPopup = memo(({
  label,
  productCode,
  detectedPrice,
  onClose,
  onQuickAdd,
}: {
  label: string;
  productCode: string;
  detectedPrice: number | null;
  onClose: () => void;
  onQuickAdd?: (label: string, productCode: string, price: number | null) => void;
}) => {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-popover border rounded-xl shadow-2xl p-4 max-w-xs w-full mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">Product not in catalog</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-2 text-xs">
          <div>
            <span className="text-muted-foreground">Detected text:</span>
            <p className="font-mono text-foreground mt-0.5 break-all">{label}</p>
          </div>
          {productCode && (
            <div>
              <span className="text-muted-foreground">Code:</span>
              <span className="ml-1 font-mono text-foreground">{productCode}</span>
            </div>
          )}
          {detectedPrice !== null && (
            <div>
              <span className="text-muted-foreground">Detected price:</span>
              <span className="ml-1 font-bold text-foreground">R{detectedPrice.toLocaleString("en-ZA")}</span>
            </div>
          )}
        </div>
        {onQuickAdd && (
          <Button
            size="sm"
            className="w-full mt-4 text-xs"
            onClick={() => {
              onQuickAdd(label, productCode, detectedPrice);
              onClose();
            }}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add to catalog
          </Button>
        )}
      </div>
    </div>
  );
});
UnmatchedPopup.displayName = "UnmatchedPopup";

const DraggableRegion = memo(({
  region,
  baskets,
  onAddProductToBasket,
  inQuoteQty,
  onProductClick,
  onUnmatchedClick,
}: {
  region: OverlayRegion;
  baskets: Basket[];
  onAddProductToBasket: (basketId: string, product: PaletteProduct) => void;
  inQuoteQty: number;
  onProductClick?: (product: PaletteProduct) => void;
  onUnmatchedClick?: (region: OverlayRegion) => void;
}) => {
  const product = region.product;
  const isMatched = !!product;
  const hasPrice = region.has_price === true;
  const isFavorite = product?.is_pinned === true;

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `pdf-overlay-${region.id}`,
    data: { product },
    disabled: !isMatched,
  });

  const price = product?.selling_price || product?.cost_incl_vat || 0;

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isMatched && product && onProductClick) {
      onProductClick(product);
    } else if (!isMatched && hasPrice && onUnmatchedClick) {
      onUnmatchedClick(region);
    }
  }, [isMatched, product, onProductClick, hasPrice, onUnmatchedClick, region]);

  // Hide regions that have no match AND no price data
  // (pdfTextExtractor already filters to only include rows with price+model code,
  //  but double-check here for safety)
  if (!isMatched && !hasPrice) return null;

  return (
    <div
      ref={isMatched ? setNodeRef : undefined}
      {...(isMatched ? { ...listeners, ...attributes } : {})}
      className={`absolute transition-all duration-150 cursor-pointer group ${
        isDragging ? "opacity-40 ring-2 ring-primary" : ""
      } ${
        isMatched
          ? inQuoteQty > 0
            ? "border-2 border-green-400/50 bg-green-500/5 hover:bg-green-500/15 hover:shadow-[0_0_12px_rgba(34,197,94,0.3)]"
            : "border border-blue-400/40 bg-blue-500/5 hover:border-blue-400/70 hover:bg-blue-500/15 hover:shadow-[0_0_12px_rgba(59,130,246,0.25)]"
          : "border border-dashed border-muted-foreground/30 hover:border-muted-foreground/50 hover:bg-muted/10"
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
      <div className="absolute top-1/2 -translate-y-1/2 -right-6 opacity-70 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
        {isMatched ? (
          inQuoteQty > 0 ? (
            <div className="h-5 w-5 rounded-full bg-green-500 flex items-center justify-center shadow-sm text-[8px] font-bold text-white">
              {inQuoteQty}
            </div>
          ) : isFavorite ? (
            <div className="flex items-center justify-center w-5 h-5 rounded-full bg-gray-900/80 shadow-sm">
              <svg viewBox="0 0 24 24" className="h-3 w-3 fill-yellow-400 text-yellow-400 drop-shadow-sm">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </div>
          ) : (
            <div className="h-4 w-4 rounded-full bg-blue-500 flex items-center justify-center shadow-sm">
              <ShoppingCart className="h-2.5 w-2.5 text-white" />
            </div>
          )
        ) : (
          /* Grey outline basket for unmatched-but-priced items */
          <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/40 bg-background flex items-center justify-center shadow-sm">
            <ShoppingCart className="h-2.5 w-2.5 text-muted-foreground/60" />
          </div>
        )}
      </div>

      {/* Hover tooltip */}
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
              {isFavorite && (
                <p className="text-yellow-600 font-medium text-[9px]">★ Favorite</p>
              )}
              <p className="text-muted-foreground/60 text-[9px] mt-0.5">
                Click for full options · Drag to zone
              </p>
            </div>
          ) : (
            <div className="space-y-0.5">
              <p className="font-semibold text-muted-foreground text-[11px]">Not in catalog</p>
              <p className="font-mono text-muted-foreground/80 truncate max-w-[250px]">{region.label}</p>
              {region.detected_price !== null && region.detected_price !== undefined && (
                <p className="text-foreground font-medium">R{region.detected_price.toLocaleString("en-ZA")}</p>
              )}
              <p className="text-muted-foreground/60 text-[9px] mt-0.5">
                Click to add to catalog
              </p>
            </div>
          )}
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
  onQuickAddProduct,
}: PdfPageOverlayProps) => {
  const [unmatchedPopup, setUnmatchedPopup] = useState<OverlayRegion | null>(null);

  const positionedRegions = regions.filter(
    (r) =>
      r.x_pct != null &&
      r.y_pct != null &&
      r.w_pct != null &&
      r.h_pct != null &&
      (r.w_pct > 0 || r.h_pct > 0)
  );

  const handleUnmatchedClick = useCallback((region: OverlayRegion) => {
    setUnmatchedPopup(region);
  }, []);

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
          onUnmatchedClick={handleUnmatchedClick}
        />
      ))}
      {unmatchedPopup && (
        <UnmatchedPopup
          label={unmatchedPopup.label}
          productCode={unmatchedPopup.product_code}
          detectedPrice={unmatchedPopup.detected_price ?? null}
          onClose={() => setUnmatchedPopup(null)}
          onQuickAdd={onQuickAddProduct}
        />
      )}
    </>
  );
};

export default PdfPageOverlay;
