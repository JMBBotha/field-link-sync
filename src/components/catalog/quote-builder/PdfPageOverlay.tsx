import { memo, useRef, useCallback } from "react";
import { computeProductPricing, resolveRowCostExVat } from "@/lib/pricing";
import { parsePdfRowSpecs } from "./parsePdfRowSpecs";
import { Info, Circle, CheckCircle2, Star } from "lucide-react";
import type { PaletteProduct, Basket } from "../QuoteBuilderTab";
import type { WizardTriggerItem } from "./QuoteBuilderPopup";
import type { PdfSelectionHandlers } from "@/types/pdfSelection";

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
  /** Fractional x (0-1) of this row's price cell (left edge), when known.
   *  Informational only — NEVER used to place the selection controls. */
  price_x_frac?: number | null;
}

/**
 * HARD LOCK (Johan + Flow, 2026-09-10): selection controls are anchored to the
 * PDF page's right edge — `right: CONTROL_RIGHT_PX` of the page overlay box.
 * Price-column coordinates are NOT used for control placement; they land on
 * the R amounts whenever the price column is mid-table.
 */
const CONTROL_RIGHT_PX = 10;
/** Width of the tap strip along the right page margin (phone / desktop). */
const STRIP_W_PHONE = 44;
const STRIP_W_DESKTOP = 64;
/** Minimum half-height (screen px) of the vertical hit window per row. */
const MIN_HIT_HALF_PX = 12;
const DOUBLE_TAP_MS = 400;
const TAP_MOVE_TOLERANCE_PX = 8;

interface PdfPageOverlayProps {
  regions: OverlayRegion[];
  baskets: Basket[];
  onAddProductToBasket?: (basketId: string, product: PaletteProduct) => void;
  basketProductCounts?: Record<string, number>;
  onProductClick?: (product: PaletteProduct) => void;
  onQuickAddProduct?: (label: string, productCode: string, price: number | null) => void;
  onToggleFavorite?: (product: PaletteProduct) => void;
  onRemoveRegion?: (region: OverlayRegion) => void;
  supplierName?: string;
  onOpenWizard?: (item: WizardTriggerItem) => void;
  onHoverStart?: (product: PaletteProduct | null, e: React.MouseEvent, priceOverride?: number | null) => void;
  onHoverMove?: (e: React.MouseEvent) => void;
  onHoverEnd?: () => void;
  pdfSelection?: PdfSelectionHandlers;
  onOpenProductInfo?: (product: PaletteProduct) => void;
  favoriteIds?: Set<string>;
  /** Kept for API compatibility; not used for control placement (see HARD LOCK). */
  priceColumnXFrac?: number | null;
}

const buildFallbackProduct = (region: OverlayRegion): PaletteProduct => ({
  id: region.id,
  product_code: region.product_code || region.id,
  short_name: region.label || region.product_code || "PDF Item",
  brand: "",
  product_category: "",
  category: "",
  cost_excl_vat: region.detected_price ?? 0,
  cost_incl_vat: region.detected_price ?? 0,
  cost_price: region.detected_price ?? 0,
  selling_price: region.detected_price ?? 0,
  default_markup_percent: 0.35,
  description: region.label || region.product_code || "PDF Item",
  is_pinned: false,
  pin_order: null,
  supplier_name: "",
  supplier_type: "",
  price_per_metre: null,
  sold_in_length: false,
  unit_length: null,
  pipe_size: null,
  is_material_favorite: false,
  pack_qty: null,
  supplier_discount_percent: null,
  markup_percent: 0.35,
});

const regionProduct = (region: OverlayRegion): PaletteProduct => region.product ?? buildFallbackProduct(region);

/** Each PDF row toggles independently, even when rows share a product_code. */
const regionSelectionCode = (region: OverlayRegion): string => region.id;

const isRegionSelected = (
  region: OverlayRegion,
  pdfSelection?: PdfSelectionHandlers,
  basketProductCounts?: Record<string, number>,
): boolean => {
  const code = regionSelectionCode(region);
  if (pdfSelection) return !!pdfSelection.selectedFromPdf.some((item) => item.code === code);
  return !!basketProductCounts?.[regionProduct(region).id];
};

/** Shared select logic (unchanged pricing behaviour) used by the margin tap strip. */
const selectRegion = (
  region: OverlayRegion,
  pdfSelection: PdfSelectionHandlers | undefined,
  baskets: Basket[],
  onAddProductToBasket?: (basketId: string, product: PaletteProduct) => void,
) => {
  const product = regionProduct(region);
  const code = regionSelectionCode(region);
  const alreadySelectedInPdf = !!pdfSelection?.selectedFromPdf.some((item) => item.code === code);

  if (pdfSelection) {
    // The row's pink-column number (region.detected_price) is the supplier
    // LIST price, not our cost. resolveRowCostExVat prefers the catalog's
    // stored (already-discounted) cost and otherwise applies the trade
    // discount to the list price, so list x 0.80 x 1.25 lands back on list.
    const effectiveCost = resolveRowCostExVat(product, region.detected_price ?? null);
    const markupPct = product.default_markup_percent ?? product.markup_percent ?? 35;
    const normalizedMarkup = markupPct > 0 && markupPct <= 1 ? markupPct * 100 : markupPct;
    const sellExVat = effectiveCost > 0
      ? Math.round(effectiveCost * (1 + normalizedMarkup / 100) * 100) / 100
      : (computeProductPricing(product).sellExVat || 0);

    const specs = parsePdfRowSpecs(region.label || "");
    pdfSelection.handleSelectProduct({
      code,
      description: product.short_name || product.description || region.label || code,
      price: String(sellExVat),
      costPrice: effectiveCost || undefined,
      markupPercent: normalizedMarkup,
      indoorModel: specs.indoorModel,
      outdoorModel: specs.outdoorModel,
      btu: specs.btu,
      kw: specs.kw,
    });
  }

  if (!alreadySelectedInPdf && baskets.length > 0 && onAddProductToBasket) {
    onAddProductToBasket(baskets[0].id, product);
  }
};

/**
 * Visual-only row: gradient pill in the right margin + painted info/radio icons.
 * No pointer handling here — the MarginHitStrip owns taps so the hit-test
 * always matches the painted row (rows on a phone are ~10px tall; per-row
 * buttons taller than that stacked over each other and stole taps 2-3 rows away).
 */
const RegionBox = memo(({
  region,
  isSelected,
  isFavorite,
  onHoverStart,
  onHoverMove,
  onHoverEnd,
  onOpenProductInfo,
}: {
  region: OverlayRegion;
  isSelected: boolean;
  isFavorite: boolean;
  onHoverStart?: (product: PaletteProduct | null, e: React.MouseEvent, priceOverride?: number | null) => void;
  onHoverMove?: (e: React.MouseEvent) => void;
  onHoverEnd?: () => void;
  onOpenProductInfo?: (product: PaletteProduct) => void;
}) => {
  const pillColor = isFavorite
    ? "hsl(45 93% 58% / 0.30)"
    : isSelected
      ? "hsl(var(--success) / 0.32)"
      : "hsl(var(--primary) / 0.22)";

  return (
    <div
      className="absolute cursor-pointer"
      style={{
        left: "0%",
        top: `${region.y_pct}%`,
        width: "100%",
        height: `${region.h_pct}%`,
      }}
      onMouseEnter={(e) => onHoverStart?.(regionProduct(region), e, region.detected_price ?? null)}
      onMouseMove={(e) => onHoverMove?.(e)}
      onMouseLeave={() => onHoverEnd?.()}
      onClick={() => onOpenProductInfo?.(regionProduct(region))}
    >
      {/* Short right-edge pill — hugs the page margin, never sweeps over R amounts */}
      <div
        className="absolute inset-y-0 right-0 pointer-events-none w-[42px] sm:w-[62px]"
        style={{ background: pillColor, borderRadius: "9999px 0 0 9999px" }}
      />

      {/* Favorite star badge — top-left of the row */}
      {isFavorite && (
        <div
          className="absolute pointer-events-none"
          style={{ left: "4px", top: "50%", transform: "translateY(-50%)" }}
        >
          <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-500 drop-shadow-sm" />
        </div>
      )}

      {/* Painted controls — anchored to the PAGE right edge; icon size clamps to row height */}
      <div
        className="absolute inset-y-0 flex items-center gap-[2px] sm:gap-1 pointer-events-none"
        style={{ right: `${CONTROL_RIGHT_PX}px` }}
      >
        <Info
          className="w-auto aspect-square text-primary opacity-75 h-[clamp(8px,100%,12px)] sm:h-[clamp(10px,100%,16px)]"
          aria-hidden
        />
        {isSelected ? (
          <CheckCircle2
            className="w-auto aspect-square h-[clamp(9px,100%,14px)] sm:h-[clamp(11px,100%,20px)]"
            style={{ color: isFavorite ? "hsl(45 93% 47%)" : "hsl(var(--success))" }}
            aria-hidden
          />
        ) : (
          <span className="relative flex items-center justify-center h-[clamp(9px,100%,14px)] sm:h-[clamp(11px,100%,20px)] aspect-square">
            <Circle className="h-full w-auto aspect-square text-muted-foreground opacity-80" aria-hidden />
            <span className="absolute rounded-full bg-muted-foreground/80" style={{ width: "45%", height: "45%" }} />
          </span>
        )}
      </div>
    </div>
  );
});
RegionBox.displayName = "RegionBox";

/**
 * One transparent strip down the page's right margin. Taps are mapped to a
 * row by converting the pointer Y into page-local space through the page
 * element's on-screen rect (which already includes pinch scale, pan and
 * scroll), then choosing the row whose centre is nearest.
 * Left part of the strip = info, right part = select.
 */
const MarginHitStrip = ({
  regions,
  pdfSelection,
  baskets,
  onAddProductToBasket,
  onOpenProductInfo,
  onToggleFavorite,
  onHoverStart,
  onHoverMove,
  onHoverEnd,
}: {
  regions: OverlayRegion[];
  pdfSelection?: PdfSelectionHandlers;
  baskets: Basket[];
  onAddProductToBasket?: (basketId: string, product: PaletteProduct) => void;
  onOpenProductInfo?: (product: PaletteProduct) => void;
  onToggleFavorite?: (product: PaletteProduct) => void;
  onHoverStart?: (product: PaletteProduct | null, e: React.MouseEvent, priceOverride?: number | null) => void;
  onHoverMove?: (e: React.MouseEvent) => void;
  onHoverEnd?: () => void;
}) => {
  const downRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const lastTapRef = useRef<{ regionId: string; at: number }>({ regionId: "", at: 0 });
  const hoverIdRef = useRef<string | null>(null);

  /** Resolve the row under a client Y using the page box rect (transform-aware). */
  const regionAtClientY = useCallback((el: HTMLElement, clientY: number): OverlayRegion | null => {
    const page = el.parentElement ?? el;
    const rect = page.getBoundingClientRect();
    if (rect.height <= 0) return null;
    const yPct = ((clientY - rect.top) / rect.height) * 100;
    const pxPerPct = rect.height / 100;
    let best: OverlayRegion | null = null;
    let bestDist = Infinity;
    for (const r of regions) {
      const centre = r.y_pct + r.h_pct / 2;
      const dist = Math.abs(centre - yPct);
      const halfWindowPct = Math.max(r.h_pct / 2, MIN_HIT_HALF_PX / pxPerPct);
      if (dist <= halfWindowPct && dist < bestDist) {
        best = r;
        bestDist = dist;
      }
    }
    return best;
  }, [regions]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    downRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const down = downRef.current;
    downRef.current = null;
    if (!down || down.id !== e.pointerId) return;
    // A moved finger is a scroll/pinch, not a tap.
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > TAP_MOVE_TOLERANCE_PX) return;

    const strip = e.currentTarget;
    const region = regionAtClientY(strip, e.clientY);
    if (!region) return;
    e.stopPropagation();

    const stripRect = strip.getBoundingClientRect();
    const xFrac = stripRect.width > 0 ? (e.clientX - stripRect.left) / stripRect.width : 1;
    const isInfoZone = xFrac < 0.42;

    if (isInfoZone) {
      onOpenProductInfo?.(regionProduct(region));
      return;
    }

    const now = Date.now();
    const last = lastTapRef.current;
    lastTapRef.current = { regionId: region.id, at: now };
    if (last.regionId === region.id && now - last.at < DOUBLE_TAP_MS && onToggleFavorite) {
      onToggleFavorite(regionProduct(region));
      return;
    }
    selectRegion(region, pdfSelection, baskets, onAddProductToBasket);
  };

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const region = regionAtClientY(e.currentTarget, e.clientY);
    if (!region) {
      if (hoverIdRef.current) { hoverIdRef.current = null; onHoverEnd?.(); }
      return;
    }
    if (hoverIdRef.current !== region.id) {
      hoverIdRef.current = region.id;
      onHoverStart?.(regionProduct(region), e, region.detected_price ?? null);
    } else {
      onHoverMove?.(e);
    }
  };

  const onMouseLeave = () => {
    if (hoverIdRef.current) { hoverIdRef.current = null; onHoverEnd?.(); }
  };

  return (
    <div
      data-testid="pdf-margin-hit-strip"
      className="absolute inset-y-0 right-0 cursor-pointer"
      style={{ width: `var(--pdf-strip-w, ${STRIP_W_PHONE}px)`, touchAction: "manipulation" }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { downRef.current = null; }}
      onClick={(e) => e.stopPropagation()}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    />
  );
};

const PdfPageOverlay = ({
  regions,
  baskets,
  onAddProductToBasket,
  basketProductCounts,
  pdfSelection,
  onOpenProductInfo,
  onToggleFavorite,
  onHoverStart,
  onHoverMove,
  onHoverEnd,
  favoriteIds,
}: PdfPageOverlayProps) => {
  if (regions.length === 0) return null;
  return (
    <>
      <style>{`@media (min-width: 640px) { [data-testid="pdf-margin-hit-strip"] { --pdf-strip-w: ${STRIP_W_DESKTOP}px; } }`}</style>
      {regions.map((region) => {
        const productId = region.product?.id || region.id;
        return (
          <RegionBox
            key={region.id}
            region={region}
            isSelected={isRegionSelected(region, pdfSelection, basketProductCounts)}
            isFavorite={!!favoriteIds?.has(productId)}
            onHoverStart={onHoverStart}
            onHoverMove={onHoverMove}
            onHoverEnd={onHoverEnd}
            onOpenProductInfo={onOpenProductInfo}
          />
        );
      })}
      <MarginHitStrip
        regions={regions}
        pdfSelection={pdfSelection}
        baskets={baskets}
        onAddProductToBasket={onAddProductToBasket}
        onOpenProductInfo={onOpenProductInfo}
        onToggleFavorite={onToggleFavorite}
        onHoverStart={onHoverStart}
        onHoverMove={onHoverMove}
        onHoverEnd={onHoverEnd}
      />
    </>
  );
};

export default PdfPageOverlay;
