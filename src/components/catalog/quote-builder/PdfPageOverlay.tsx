import { useState, memo, useCallback, useMemo } from "react";
import { useDraggable } from "@dnd-kit/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ShoppingCart, Plus, X, Star, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { categorizePdfItem, categoryToWizardStep } from "./categorizePdfItem";
import type { PaletteProduct, Basket } from "../QuoteBuilderTab";
import type { WizardTriggerItem } from "./QuoteBuilderPopup";

const DISMISSED_KEY = "dismissedPdfRegions";

/**
 * Dynamically compute icon column position from region data.
 * Uses the rightmost edge (x_pct + w_pct) of all regions on this page,
 * then adds a small gap. Clamps between 85-96% to stay inside the page.
 * Falls back to 91% if no valid region geometry exists.
 */
function computeIconLeftPct(regions: OverlayRegion[]): string {
  let maxRight = 0;
  let hasValidGeometry = false;
  for (const r of regions) {
    if (r.x_pct != null && r.w_pct != null && r.w_pct > 0) {
      const right = r.x_pct + r.w_pct;
      if (right > maxRight) {
        maxRight = right;
        hasValidGeometry = true;
      }
    }
  }
  if (!hasValidGeometry || maxRight < 10) return "91%";
  // Add ~1% padding after the rightmost content edge, clamp to 85-96%
  const iconPct = Math.min(96, Math.max(85, maxRight + 1));
  return `${iconPct.toFixed(1)}%`;
}

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
  supplierName?: string;
  /** Opens the Area Quote Builder with pre-filled item context */
  onOpenWizard?: (item: WizardTriggerItem) => void;
}

/* ─── Added-to-quote tracker (local state, shared across regions) ─── */
const addedQuoteItemIds = new Set<string>();

/* ─── DraggableRegion: one per product row ─── */
const DraggableRegion = memo(({
  region,
  baskets,
  onAddProductToBasket,
  inQuoteQty,
  onProductClick,
  onUnmatchedClick,
  onToggleFavorite,
  onRemoveRegion,
  onRowStripClick,
  isAddedToQuote,
  iconLeftPct,
}: {
  region: OverlayRegion;
  baskets: Basket[];
  onAddProductToBasket: (basketId: string, product: PaletteProduct) => void;
  inQuoteQty: number;
  onProductClick?: (product: PaletteProduct) => void;
  onUnmatchedClick?: (region: OverlayRegion) => void;
  onToggleFavorite?: (product: PaletteProduct) => void;
  onRemoveRegion?: (region: OverlayRegion) => void;
  onRowStripClick?: (region: OverlayRegion) => void;
  isAddedToQuote?: boolean;
  iconLeftPct: string;
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

  // Strip click → opens quote item popup
  const handleStripClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (onRowStripClick) {
      onRowStripClick(region);
    }
  }, [onRowStripClick, region]);

  // Icon click → open Area Quote Builder (same as strip click)
  const handleIconClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (onRowStripClick) {
      onRowStripClick(region);
    }
  }, [onRowStripClick, region]);

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
      (supabase.from("dismissed_pdf_regions") as any)
        .upsert({ dismiss_key: dismissId }, { onConflict: "dismiss_key" })
        .then(({ error }: any) => {
          if (error) console.error("[PdfOverlay] Failed to persist dismiss:", error.message);
        });
      if (onRemoveRegion) onRemoveRegion(region);
    }
  }, [onRemoveRegion, region]);

  // Determine icon color based on state
  const iconBg = isAddedToQuote ? "#28a745" : "#007BFF";

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
      onClick={handleStripClick}
      onContextMenu={handleContextMenu}
    >
      {/* Full-width transparent hit area with hover highlight */}
      <div className="absolute inset-0 hover:bg-primary/5 rounded transition-colors duration-150" />

      {/* Icon positioned in QTY column at fixed left% */}
      <div
        className="absolute top-1/2 -translate-y-1/2 opacity-80 group-hover:opacity-100 transition-opacity z-10 flex flex-row items-center"
        style={{ left: iconLeftPct }}
      >
        {isMatched ? (
          isFavorite ? (
            <button
              onDoubleClick={handleStarDoubleClick}
              onClick={handleIconClick}
              onContextMenu={handleContextMenu}
              className="pointer-events-auto h-5 w-5 rounded-full flex items-center justify-center hover:scale-125 transition-transform cursor-pointer shadow-md"
              style={{ background: "rgba(30,30,30,0.85)" }}
              title="Double-click to remove from favorites · Right-click to hide"
              aria-label="Remove from favorites"
            >
              <Star className="h-3 w-3" style={{ fill: "#FFD700", color: "#FFD700" }} />
            </button>
          ) : isAddedToQuote ? (
            <button
              onDoubleClick={handleStarDoubleClick}
              onClick={handleIconClick}
              onContextMenu={handleContextMenu}
              className="pointer-events-auto h-5 w-5 rounded-full flex items-center justify-center hover:scale-125 transition-transform cursor-pointer shadow-md"
              style={{ background: "#28a745" }}
              title="Added to quote · Double-click to favorite · Right-click to hide"
              aria-label="Added to quote"
            >
              <Check className="h-2.5 w-2.5 text-white" />
            </button>
          ) : inQuoteQty > 0 ? (
            <button
              onDoubleClick={handleStarDoubleClick}
              onClick={handleIconClick}
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
              onClick={handleIconClick}
              onContextMenu={handleContextMenu}
              className="pointer-events-auto h-5 w-5 rounded-full flex items-center justify-center hover:scale-125 transition-transform cursor-pointer shadow-md"
              style={{ background: iconBg }}
              title="Click row to add to quote · Double-click icon to favorite · Right-click to hide"
              aria-label="Add to quote"
            >
              <ShoppingCart className="h-2.5 w-2.5 text-white" />
            </button>
          )
        ) : (
          <button
            className="pointer-events-auto h-5 w-5 rounded-full flex items-center justify-center hover:scale-125 transition-all cursor-pointer shadow-md"
            style={{ background: "#f97316" }}
            onClick={handleIconClick}
            onContextMenu={handleContextMenu}
            title="Right-click to hide"
            aria-label="Unmatched product. Right-click to hide"
          >
            <ShoppingCart className="h-2.5 w-2.5 text-white" />
          </button>
        )}
      </div>

      {/* Hover tooltip */}
      <div
        className="absolute bottom-full mb-1.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50"
        style={{ left: iconLeftPct }}
      >
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
              {isAddedToQuote && (
                <p className="text-green-600 font-medium text-[9px]">✓ Added to quote</p>
              )}
              <p className="text-muted-foreground/60 text-[9px] mt-0.5">
                Click row to add · Drag to zone
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
                Click row to add manually
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

DraggableRegion.displayName = "DraggableRegion";

/* ─── Ghost "+" icon for rows without any overlay ─── */
const GhostAddRow = memo(({
  yPct,
  hPct,
  onClick,
  iconLeftPct,
}: {
  yPct: number;
  hPct: number;
  onClick: () => void;
  iconLeftPct: string;
}) => (
  <div
    className="absolute cursor-pointer group"
    style={{
      left: "0%",
      top: `${yPct}%`,
      width: "96%",
      height: `${hPct}%`,
      minHeight: "18px",
      margin: 0,
      padding: 0,
    }}
    onClick={(e) => { e.stopPropagation(); onClick(); }}
  >
    {/* Hover highlight */}
    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 hover:bg-primary/5 rounded transition-colors duration-150" />
    {/* Ghost + icon — only visible on hover */}
    <div
      className="absolute top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity z-10"
      style={{ left: iconLeftPct }}
    >
      <div className="h-4 w-4 rounded-full flex items-center justify-center bg-muted-foreground/20 hover:bg-muted-foreground/40 transition-colors">
        <Plus className="h-2.5 w-2.5 text-muted-foreground" />
      </div>
    </div>
  </div>
));
GhostAddRow.displayName = "GhostAddRow";

/* ─── Main PdfPageOverlay component ─── */
const PdfPageOverlay = ({
  regions,
  baskets,
  onAddProductToBasket,
  basketProductCounts,
  onProductClick,
  onQuickAddProduct,
  onToggleFavorite,
  onRemoveRegion,
  supplierName,
  onOpenWizard,
}: PdfPageOverlayProps) => {
  const [localAddedIds, setLocalAddedIds] = useState<Set<string>>(new Set());
  const [, forceUpdate] = useState(0);
  const queryClient = useQueryClient();

  // Fetch persisted dismissed keys from DB
  const { data: dbDismissedKeys = new Set<string>() } = useQuery({
    queryKey: ["dismissed-pdf-regions"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("dismissed_pdf_regions") as any)
        .select("dismiss_key");
      if (error) {
        console.error("[PdfOverlay] Failed to fetch dismissed regions:", error.message);
        return new Set<string>();
      }
      return new Set<string>((data || []).map((r: any) => r.dismiss_key));
    },
    staleTime: 30000,
  });

  // Merge localStorage + DB dismissed IDs
  const dismissedIds = useMemo(() => {
    const local = getDismissedIds();
    return new Set([...local, ...dbDismissedKeys]);
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


  const handleRemoveRegion = useCallback((region: OverlayRegion) => {
    forceUpdate(n => n + 1);
    queryClient.invalidateQueries({ queryKey: ["dismissed-pdf-regions"] });
    onRemoveRegion?.(region);
  }, [onRemoveRegion, queryClient]);

  // Row strip click → open Area Quote Builder with smart categorization
  const handleRowStripClick = useCallback((region: OverlayRegion) => {
    if (!onOpenWizard) return;
    const product = region.product;
    const name = product?.short_name || product?.product_code || region.label.substring(0, 80);
    const code = product?.product_code || region.product_code || "";
    const description = product?.description || region.label || "";
    const price = product?.selling_price || product?.cost_incl_vat || region.detected_price || 0;

    const category = categorizePdfItem({ name, description, code });
    const step = categoryToWizardStep(category);

    onOpenWizard({ name, code, description, price, category, step });
  }, [onOpenWizard]);

  // Manual add from ghost row → open wizard at materials step
  const handleManualRowClick = useCallback((_yPct: number) => {
    if (!onOpenWizard) return;
    onOpenWizard({ name: "", code: "", description: "", price: 0, category: "UNKNOWN", step: 1 });
  }, [onOpenWizard]);



  // Generate ghost rows for gaps between positioned regions
  const ghostRows = useMemo(() => {
    if (positionedRegions.length === 0) return [];
    const sorted = [...positionedRegions].sort((a, b) => a.y_pct - b.y_pct);
    const gaps: { yPct: number; hPct: number }[] = [];
    
    for (let i = 0; i < sorted.length - 1; i++) {
      const endOfCurrent = sorted[i].y_pct + sorted[i].h_pct;
      const startOfNext = sorted[i + 1].y_pct;
      const gap = startOfNext - endOfCurrent;
      if (gap > 1.5) {
        // There's a gap — could be an unmatched row
        gaps.push({ yPct: endOfCurrent + gap * 0.2, hPct: gap * 0.6 });
      }
    }
    return gaps;
  }, [positionedRegions]);

  // Dynamically compute icon column position from region geometry
  const iconLeftPct = useMemo(() => computeIconLeftPct(positionedRegions), [positionedRegions]);

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
          onUnmatchedClick={handleRowStripClick}
          onToggleFavorite={onToggleFavorite}
          onRemoveRegion={handleRemoveRegion}
          onRowStripClick={handleRowStripClick}
          isAddedToQuote={
            region.product
              ? localAddedIds.has(region.product.id) || addedQuoteItemIds.has(region.product.id)
              : false
          }
          iconLeftPct={iconLeftPct}
        />
      ))}

      {/* Ghost + rows for gaps */}
      {ghostRows.map((gap, i) => (
        <GhostAddRow
          key={`ghost-${i}`}
          yPct={gap.yPct}
          hPct={gap.hPct}
          onClick={() => handleManualRowClick(gap.yPct)}
          iconLeftPct={iconLeftPct}
        />
      ))}

    </>
  );
};

export default PdfPageOverlay;
