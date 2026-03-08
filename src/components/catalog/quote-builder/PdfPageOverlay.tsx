import { memo } from "react";
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
const RegionBox = memo(({ region }: { region: OverlayRegion }) => (
  <div
    className="absolute border-2 border-primary pointer-events-none"
    style={{
      left: `0%`, // Span full width starting from left edge
      top: `${region.y_pct}%`,
      width: `100%`, // Full width of the row
      height: `${region.h_pct}%`,
    }}
    title={`${region.label} (${region.product_code})`}
  />
));
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
