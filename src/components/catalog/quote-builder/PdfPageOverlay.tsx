import { useState, memo, useCallback, useMemo } from "react";
import { useDraggable } from "@dnd-kit/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ShoppingCart, Plus, X, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { PaletteProduct, Basket } from "../QuoteBuilderTab";

const DISMISSED_KEY = "dismissedPdfRegions";

function getDismissedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function addDismissedId(id: string) {
  const set = getDismissedIds();
  set.add(id);
  localStorage.setItem(DISMISSED_KEY, JSON.stringify([...set]));
}

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
  onToggleFavorite?: (product: PaletteProduct) => void;
  onRemoveRegion?: (region: OverlayRegion) => void;
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
  onToggleFavorite,
  onRemoveRegion,
}: {
  region: OverlayRegion;
  baskets: Basket[];
  onAddProductToBasket: (basketId: string, product: PaletteProduct) => void;
  inQuoteQty: number;
  onProductClick?: (product: PaletteProduct) => void;
  onUnmatchedClick?: (region: OverlayRegion) => void;
  onToggleFavorite?: (product: PaletteProduct) => void;
  onRemoveRegion?: (region: OverlayRegion) => void;
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
    e.stopPropagation();
    if (isMatched && product && onProductClick) {
      onProductClick(product);
    } else if (!isMatched && onUnmatchedClick) {
      onUnmatchedClick(region);
    }
  }, [isMatched, product, onProductClick, onUnmatchedClick, region]);

  const handleStarDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (isMatched && product && onToggleFavorite) {
      onToggleFavorite(product);
    }
  }, [isMatched, product, onToggleFavorite]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const label = region.label.substring(0, 80);
    if (window.confirm(`Hide this overlay icon permanently?\n\n${label}`)) {
      const dismissId = `${region.product_code}|${region.label.substring(0, 40)}`;
      addDismissedId(dismissId);
      // Persist to Supabase
      (supabase.from("dismissed_pdf_regions") as any)
        .upsert({ dismiss_key: dismissId }, { onConflict: "dismiss_key" })
        .then(({ error }: any) => {
          if (error) console.error("[PdfOverlay] Failed to persist dismiss:", error.message);
          else console.log("[PdfOverlay] Persisted dismiss_key:", dismissId);
        });
      if (onRemoveRegion) onRemoveRegion(region);
    }
  }, [onRemoveRegion, region]);

  return (
    <div
      ref={isMatched ? setNodeRef : undefined}
      {...(isMatched ? { ...listeners, ...attributes } : {})}
      className={`absolute transition-all duration-150 cursor-pointer group ${
        isDragging ? "opacity-40 ring-2 ring-primary" : ""
      }`}
      style={{
        left: "0%",
        top: `${region.y_pct}%`,
        width: "96%",
        height: `${region.h_pct}%`,
        touchAction: "none",
        minHeight: "18px",
        margin: 0,
        padding: 0,
      }}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      {/* Full-width transparent hit area + icon positioned in QTY column */}
      <div className="absolute inset-0 hover:bg-primary/5 rounded transition-colors duration-150" />
      <div className="absolute top-1/2 -translate-y-1/2 opacity-80 group-hover:opacity-100 transition-opacity z-10 flex flex-row items-center" style={{ left: "90%" }}>
        {isMatched ? (
          isFavorite ? (
            <button
              onDoubleClick={handleStarDoubleClick}
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
              onContextMenu={handleContextMenu}
              className="pointer-events-auto h-5 w-5 rounded-full flex items-center justify-center hover:scale-125 transition-transform cursor-pointer shadow-md"
              style={{ background: "rgba(30,30,30,0.85)" }}
              title="Double-click to remove from favorites · Right-click to hide"
              aria-label="Remove from favorites"
            >
              <Star className="h-3 w-3" style={{ fill: "#FFD700", color: "#FFD700" }} />
            </button>
          ) : inQuoteQty > 0 ? (
            <button
              onDoubleClick={handleStarDoubleClick}
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
              onContextMenu={handleContextMenu}
              className="pointer-events-auto h-5 w-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white hover:scale-125 transition-transform cursor-pointer shadow-md"
              style={{ background: "#22c55e" }}
              title="Double-click to add to favorites · Right-click to hide"
              aria-label={`In quote: ${inQuoteQty}. Double-click to favorite`}
            >
              {inQuoteQty}
            </button>
          ) : (
            <button
              onDoubleClick={handleStarDoubleClick}
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
              onContextMenu={handleContextMenu}
              className="pointer-events-auto h-5 w-5 rounded-full flex items-center justify-center hover:scale-125 transition-transform cursor-pointer shadow-md"
              style={{ background: "#007BFF" }}
              title="Double-click to add to favorites · Right-click to hide"
              aria-label="Add to favorites"
            >
              <ShoppingCart className="h-2.5 w-2.5 text-white" />
            </button>
          )
        ) : (
          <button
            className="pointer-events-auto h-5 w-5 rounded-full flex items-center justify-center hover:scale-125 transition-all cursor-pointer shadow-md"
            style={{ background: "#f97316" }}
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
            onContextMenu={handleContextMenu}
            title="Right-click to hide"
            aria-label="Unmatched product. Right-click to hide"
          >
            <ShoppingCart className="h-2.5 w-2.5 text-white" />
          </button>
        )}
      </div>

      {/* Hover tooltip */}
      <div className="absolute bottom-full mb-1.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50" style={{ left: "90%" }}>
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
  onToggleFavorite,
  onRemoveRegion,
}: PdfPageOverlayProps) => {
  const [unmatchedPopup, setUnmatchedPopup] = useState<OverlayRegion | null>(null);
  const [, forceUpdate] = useState(0);
  const queryClient = useQueryClient();

  // Fetch persisted dismissed keys from Supabase
  const { data: dbDismissedKeys = new Set<string>() } = useQuery({
    queryKey: ["dismissed-pdf-regions"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("dismissed_pdf_regions") as any)
        .select("dismiss_key");
      if (error) {
        console.error("[PdfOverlay] Failed to fetch dismissed regions:", error.message);
        return new Set<string>();
      }
      const keys = new Set<string>((data || []).map((r: any) => r.dismiss_key));
      console.log(`[PdfOverlay] Loaded ${keys.size} dismissed regions from DB`);
      return keys;
    },
    staleTime: 30000,
  });

  // Merge localStorage (immediate) + DB (persistent) dismissed IDs
  const dismissedIds = useMemo(() => {
    const local = getDismissedIds();
    const merged = new Set([...local, ...dbDismissedKeys]);
    return merged;
  }, [dbDismissedKeys]);

  const positionedRegions = useMemo(() =>
    regions.filter((r) => {
      if (r.x_pct == null || r.y_pct == null || r.w_pct == null || r.h_pct == null) return false;
      if (r.w_pct <= 0 && r.h_pct <= 0) return false;
      const dismissId = `${r.product_code}|${r.label.substring(0, 40)}`;
      if (dismissedIds.has(dismissId)) return false;
      return true;
    }),
    [regions, dismissedIds]
  );

  const handleUnmatchedClick = useCallback((region: OverlayRegion) => {
    setUnmatchedPopup(region);
  }, []);

  const handleRemoveRegion = useCallback((region: OverlayRegion) => {
    forceUpdate(n => n + 1);
    queryClient.invalidateQueries({ queryKey: ["dismissed-pdf-regions"] });
    onRemoveRegion?.(region);
  }, [onRemoveRegion, queryClient]);

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
          onToggleFavorite={onToggleFavorite}
          onRemoveRegion={handleRemoveRegion}
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
