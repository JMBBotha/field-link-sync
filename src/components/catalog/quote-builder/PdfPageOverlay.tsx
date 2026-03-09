import { useState } from "react";
import { ShoppingCart, Circle } from "lucide-react";
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
  price_center_x?: number;
  price_center_y?: number;
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

const safeNum = (v: number | null | undefined): number =>
  v != null && isFinite(v) ? v : 0;

const ProductPopup = ({ region }: { region: OverlayRegion }) => {
  const p = region.product;
  const costExVat = safeNum(p?.cost_excl_vat);
  const sellingPrice = safeNum(p?.selling_price);
  const markup = costExVat > 0 ? Math.round((sellingPrice / costExVat - 1) * 100) : safeNum(p?.default_markup_percent);

  return (
    <div
      className="absolute z-50 pointer-events-none rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-3 w-56"
      style={{ bottom: "100%", right: 0, marginBottom: 8 }}
    >
      <p className="font-semibold text-sm truncate">{region.label}</p>
      <p className="text-xs text-muted-foreground mt-0.5">Code: {region.product_code}</p>
      <div className="mt-2 space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Cost (ex-VAT)</span>
          <span className="font-medium">R {costExVat.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Selling Price</span>
          <span className="font-medium">R {sellingPrice.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Markup</span>
          <span className="font-medium">{markup}%</span>
        </div>
        {region.detected_price != null && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">PDF Price</span>
            <span className="font-medium">R {safeNum(region.detected_price).toFixed(2)}</span>
          </div>
        )}
        {p?.description && (
          <p className="text-muted-foreground pt-1 border-t border-border mt-1 line-clamp-2">
            {p.description}
          </p>
        )}
      </div>
    </div>
  );
};

const PdfPageOverlay = ({ regions }: PdfPageOverlayProps) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  if (regions.length === 0) return null;

  // Find the rightmost edge of all regions on this page
  let maxRightPct = 0;
  regions.forEach((r) => {
    const right = r.x_pct + r.w_pct;
    if (right > maxRightPct) maxRightPct = right;
  });
  const iconsLeftPct = Math.min(maxRightPct + 2, 95);
  const chevronTipPct = iconsLeftPct - 1; // gradient arrow ends just before icons

  return (
    <>
      {regions.map((region) => {
        const priceCenterY = region.price_center_y || region.y_pct + region.h_pct / 2;
        const rowTop = region.y_pct;
        const rowHeight = region.h_pct;
        const rowLeft = region.x_pct;
        const gradientWidth = Math.max(chevronTipPct - rowLeft, 0);

        return (
          <div key={region.id}>
            {/* Gradient row highlight with chevron arrow end — triggers popup on hover */}
            <div
              className="absolute pointer-events-auto cursor-pointer"
              style={{
                left: `${rowLeft}%`,
                top: `${rowTop}%`,
                width: `${gradientWidth}%`,
                height: `${rowHeight}%`,
                background: "linear-gradient(to right, transparent 0%, hsl(var(--muted) / 0.45) 70%, hsl(var(--muted-foreground) / 0.25) 100%)",
                clipPath: "polygon(0 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 0 100%)",
              }}
              onMouseEnter={() => setHoveredId(region.id)}
              onMouseLeave={() => setHoveredId(null)}
            />

            {/* Icons */}
            <div
              className="absolute pointer-events-auto flex items-center gap-[6px]"
              style={{
                left: `${iconsLeftPct}%`,
                top: `${priceCenterY}%`,
                transform: "translateY(-50%)",
              }}
            >
              <Circle className="cursor-pointer text-primary" size={16} />
              <div className="relative">
                <ShoppingCart className="cursor-pointer text-primary" size={16} />
                {hoveredId === region.id && <ProductPopup region={region} />}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
};

export default PdfPageOverlay;
