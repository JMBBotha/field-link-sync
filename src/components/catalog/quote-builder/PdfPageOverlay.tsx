import { memo } from "react";
import { Info, Circle, CheckCircle2 } from "lucide-react";
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
  onHoverStart?: (product: PaletteProduct | null, e: React.MouseEvent) => void;
  onHoverMove?: (e: React.MouseEvent) => void;
  onHoverEnd?: () => void;
  pdfSelection?: PdfSelectionHandlers;
  onOpenProductInfo?: (product: PaletteProduct) => void;
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
  default_markup_percent: 0,
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
  markup_percent: null,
});

const RegionBox = memo(({
  region,
  onOpenProductInfo,
  onAddProductToBasket,
  baskets,
  basketProductCounts,
  pdfSelection,
}: {
  region: OverlayRegion;
  onOpenProductInfo?: (product: PaletteProduct) => void;
  onAddProductToBasket?: (basketId: string, product: PaletteProduct) => void;
  baskets: Basket[];
  basketProductCounts?: Record<string, number>;
  pdfSelection?: PdfSelectionHandlers;
}) => {
  const getProductOrFallback = (): PaletteProduct => region.product ?? buildFallbackProduct(region);

  const getSelectionCode = (product: PaletteProduct): string =>
    region.product_code || product.product_code || product.id;

  const productForState = getProductOrFallback();
  const selectionCode = getSelectionCode(productForState);

  const isSelectedInPdf = !!pdfSelection?.selectedFromPdf.some((item) => item.code === selectionCode);
  const isSelectedInQuote = !!basketProductCounts?.[productForState.id];
  const isSelected = isSelectedInPdf || isSelectedInQuote;

  const handleRadioClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    const product = getProductOrFallback();
    const code = getSelectionCode(product);
    const alreadySelectedInPdf = !!pdfSelection?.selectedFromPdf.some((item) => item.code === code);

    if (pdfSelection) {
      const displayPrice = product.selling_price || product.cost_incl_vat || region.detected_price || 0;
      pdfSelection.handleSelectProduct({
        code,
        description: product.short_name || product.description || region.label || code,
        price: String(displayPrice),
        costPrice: product.cost_excl_vat || product.cost_price || undefined,
        markupPercent: product.default_markup_percent ?? product.markup_percent ?? undefined,
      });
    }

    if (!alreadySelectedInPdf && !isSelectedInQuote && baskets.length > 0 && onAddProductToBasket) {
      onAddProductToBasket(baskets[0].id, product);
    }
  };

  const handleInfoClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onOpenProductInfo) return;
    onOpenProductInfo(getProductOrFallback());
  };

  return (
    <div
      className="absolute"
      style={{
        left: "0%",
        top: `${region.y_pct}%`,
        width: "100%",
        height: `${region.h_pct}%`,
      }}
      title={`${region.label} (${region.product_code})`}
    >
      {/* Grey-to-blue gradient with pill-shaped right end */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: isSelected
            ? "linear-gradient(to right, transparent 0%, transparent 40%, hsl(var(--success) / 0.15) 55%, hsl(var(--success) / 0.25) 80%, hsl(var(--success) / 0.45) 100%)"
            : "linear-gradient(to right, transparent 0%, transparent 40%, hsl(var(--muted) / 0.3) 55%, hsl(var(--primary) / 0.25) 80%, hsl(var(--primary) / 0.45) 100%)",
          borderRadius: "0 9999px 9999px 0",
        }}
      />

      {/* Buttons — inside the page, pinned to right edge, vertically centered */}
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
          className="flex items-center justify-center rounded-full transition-colors hover:scale-110"
          title="Product info"
        >
          <Info className="h-4 w-4 text-primary opacity-70 hover:opacity-100" />
        </button>

        {/* Radio / select button */}
        <button
          onClick={handleRadioClick}
          className="flex items-center justify-center rounded-full transition-colors hover:scale-110"
          title={isSelected ? "Added to quote" : "Add to quote"}
        >
          {isSelected ? (
            <CheckCircle2 className="h-5 w-5" style={{ color: "hsl(var(--success))" }} />
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
}: PdfPageOverlayProps) => {
  if (regions.length === 0) return null;
  return (
    <>
      {regions.map((region) => (
        <RegionBox
          key={region.id}
          region={region}
          onOpenProductInfo={onOpenProductInfo}
          onAddProductToBasket={onAddProductToBasket}
          baskets={baskets}
          basketProductCounts={basketProductCounts}
          pdfSelection={pdfSelection}
        />
      ))}
    </>
  );
};

export default PdfPageOverlay;
