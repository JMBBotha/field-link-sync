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
}

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

const RegionBox = memo(({
  region,
  onOpenProductInfo,
  onAddProductToBasket,
  onToggleFavorite,
  baskets,
  basketProductCounts,
  pdfSelection,
  onHoverStart,
  onHoverMove,
  onHoverEnd,
  isFavorite,
}: {
  region: OverlayRegion;
  onOpenProductInfo?: (product: PaletteProduct) => void;
  onAddProductToBasket?: (basketId: string, product: PaletteProduct) => void;
  onToggleFavorite?: (product: PaletteProduct) => void;
  baskets: Basket[];
  basketProductCounts?: Record<string, number>;
  pdfSelection?: PdfSelectionHandlers;
  onHoverStart?: (product: PaletteProduct | null, e: React.MouseEvent, priceOverride?: number | null) => void;
  onHoverMove?: (e: React.MouseEvent) => void;
  onHoverEnd?: () => void;
  isFavorite: boolean;
}) => {
  const getProductOrFallback = (): PaletteProduct => region.product ?? buildFallbackProduct(region);

  // Use region.id so each PDF row toggles independently, even when
  // multiple rows on the page share the same product_code.
  const getSelectionCode = (_product: PaletteProduct): string => region.id;

  const productForState = getProductOrFallback();
  const selectionCode = getSelectionCode(productForState);

  const isSelectedInPdf = !!pdfSelection?.selectedFromPdf.some((item) => item.code === selectionCode);
  const isSelected = pdfSelection ? isSelectedInPdf : !!basketProductCounts?.[productForState.id];

  // Double-click detection for favorite toggle
  const lastClickRef = useRef<number>(0);

  const handleRadioClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();

    const now = Date.now();
    const isDoubleClick = now - lastClickRef.current < 400;
    lastClickRef.current = now;

    if (isDoubleClick && onToggleFavorite) {
      onToggleFavorite(getProductOrFallback());
      return;
    }

    const product = getProductOrFallback();
    const code = getSelectionCode(product);
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
  }, [pdfSelection, baskets, onAddProductToBasket, onToggleFavorite, region]);

  const handleInfoClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onOpenProductInfo) return;
    onOpenProductInfo(getProductOrFallback());
  };

  const handleMouseEnter = (e: React.MouseEvent) => {
    if (onHoverStart) onHoverStart(getProductOrFallback(), e, region.detected_price ?? null);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (onHoverMove) onHoverMove(e);
  };

  const handleMouseLeave = () => {
    if (onHoverEnd) onHoverEnd();
  };

  const handleRowClick = () => {
    if (onOpenProductInfo) onOpenProductInfo(getProductOrFallback());
  };

  // Determine gradient based on state priority: favorite > selected > default
  const getGradient = () => {
    if (isFavorite) {
      return "linear-gradient(to right, transparent 0%, transparent 30%, hsl(45 93% 58% / 0.12) 50%, hsl(45 93% 58% / 0.22) 75%, hsl(45 93% 58% / 0.38) 100%)";
    }
    if (isSelected) {
      return "linear-gradient(to right, transparent 0%, transparent 40%, hsl(var(--success) / 0.15) 55%, hsl(var(--success) / 0.25) 80%, hsl(var(--success) / 0.45) 100%)";
    }
    return "linear-gradient(to right, transparent 0%, transparent 40%, hsl(var(--muted) / 0.3) 55%, hsl(var(--primary) / 0.25) 80%, hsl(var(--primary) / 0.45) 100%)";
  };

  return (
    <div
      className="absolute cursor-pointer"
      style={{
        left: "0%",
        top: `${region.y_pct}%`,
        width: "100%",
        height: `${region.h_pct}%`,
      }}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleRowClick}
    >
      {/* Gradient highlight */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: getGradient(),
          borderRadius: "0 9999px 9999px 0",
        }}
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

      {/* Buttons — pinned to right edge */}
      <div
        className="absolute flex items-center gap-1"
        style={{
          right: "21px",
          top: "50%",
          transform: "translateY(-50%)",
        }}
      >
        {/* Info button */}
        <button
          onClick={handleInfoClick}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className="flex items-center justify-center rounded-full transition-colors hover:scale-110"
          title="Product info"
        >
          <Info className="h-4 w-4 text-primary opacity-70 hover:opacity-100" />
        </button>

        {/* Radio / select button — double-click to favorite */}
        <button
          onClick={handleRadioClick}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className="flex items-center justify-center rounded-full transition-colors hover:scale-110"
          title={isFavorite ? "★ Favorite (double-click to unfavorite)" : isSelected ? "Added to quote (double-click to favorite)" : "Add to quote (double-click to favorite)"}
        >
          {isSelected ? (
            <CheckCircle2 className="h-5 w-5" style={{ color: isFavorite ? "hsl(45 93% 47%)" : "hsl(var(--success))" }} />
          ) : (
            <span className="relative flex items-center justify-center h-5 w-5">
              <Circle className="h-5 w-5 text-muted-foreground opacity-70" />
              <span className="absolute h-2.5 w-2.5 rounded-full bg-muted-foreground/80" />
            </span>
          )}
        </button>
      </div>
    </div>
  );
});
RegionBox.displayName = "RegionBox";

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
      {regions.map((region) => {
        const productId = region.product?.id || region.id;
        return (
          <RegionBox
            key={region.id}
            region={region}
            onOpenProductInfo={onOpenProductInfo}
            onAddProductToBasket={onAddProductToBasket}
            onToggleFavorite={onToggleFavorite}
            baskets={baskets}
            basketProductCounts={basketProductCounts}
            pdfSelection={pdfSelection}
            onHoverStart={onHoverStart}
            onHoverMove={onHoverMove}
            onHoverEnd={onHoverEnd}
            isFavorite={!!favoriteIds?.has(productId)}
          />
        );
      })}
    </>
  );
};

export default PdfPageOverlay;
