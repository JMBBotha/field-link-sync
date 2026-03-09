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

const RegionBox = memo(({ region }: { region: OverlayRegion }) => {
  const priceCenterX = region.price_center_x || region.x_pct + region.w_pct / 2;
  const priceCenterY = region.price_center_y || region.y_pct + region.h_pct / 2;

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: `${region.x_pct}%`,
        top: `${region.y_pct}%`,
        width: `${region.w_pct}%`,
        height: `${region.h_pct}%`,
      }}
    >
      {/* Radio + Cart container, shifted right of price center */}
      <div
        className="absolute pointer-events-auto flex items-center gap-[6px]"
        style={{
          left: `${priceCenterX - region.x_pct + 64}%`,
          top: `${priceCenterY - region.y_pct - 1}%`,
          transform: "translateY(-50%)",
        }}
      >
        <Circle className="cursor-pointer text-primary" size={16} />
        <ShoppingCart className="cursor-pointer text-primary" size={16} />
      </div>
    </div>
  );
});

RegionBox.displayName = "RegionBox";

const PdfPageOverlay = ({ regions }: PdfPageOverlayProps) => {
  if (regions.length === 0) return null;
  return (
    <>
      {regions.map((region) => (
        <RegionBox key={region.id} region={region} />
      ))}
    </>
  );
};

export default PdfPageOverlay;
