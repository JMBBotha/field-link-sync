import { memo } from "react";
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

const PdfPageOverlay = ({ regions }: PdfPageOverlayProps) => {
  if (regions.length === 0) return null;

  // Find the rightmost edge of all regions on this page (percentage-based)
  let maxRightPct = 0;
  regions.forEach((r) => {
    const right = r.x_pct + r.w_pct;
    if (right > maxRightPct) maxRightPct = right;
  });
  // Position icons ~1cm outside the rightmost column edge
  const iconsLeftPct = maxRightPct + 5;

  return (
    <>
      {regions.map((region) => {
        const priceCenterY = region.price_center_y || region.y_pct + region.h_pct / 2;
        return (
          <div
            key={region.id}
            className="absolute pointer-events-auto flex items-center gap-[6px]"
            style={{
              left: `${iconsLeftPct}%`,
              top: `${priceCenterY}%`,
              transform: "translateY(-50%)",
            }}
          >
            <Circle className="cursor-pointer text-primary" size={16} />
            <ShoppingCart className="cursor-pointer text-primary" size={16} />
          </div>
        );
      })}
    </>
  );
};

export default PdfPageOverlay;
