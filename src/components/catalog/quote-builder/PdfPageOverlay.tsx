import { useState, memo } from "react";
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
      style={{ bottom: "100%", left: "50%", transform: "translateX(-50%)", marginBottom: 8 }}
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

const RegionBox = memo(({ region, hoveredId, setHoveredId }: {
  region: OverlayRegion;
  hoveredId: string | null;
  setHoveredId: (id: string | null) => void;
}) => {
  const priceCenterX = region.price_center_x || region.x_pct + region.w_pct / 2;
  const priceCenterY = region.price_center_y || region.y_pct + region.h_pct / 2;
  const isHovered = hoveredId === region.id;

  return (
    <div
      className="absolute inset-0 pointer-events-auto"
      style={{ left: `${region.x_pct}%`, top: `${region.y_pct}%`, width: `${region.w_pct}%`, height: `${region.h_pct}%` }}
      onMouseEnter={() => setHoveredId(region.id)}
      onMouseLeave={() => setHoveredId(null)}
    >
      {/* Gradient row highlight with chevron */}
      <div
        className="absolute inset-0 rounded-sm transition-opacity duration-150"
        style={{
          background: "linear-gradient(to right, hsl(var(--primary) / 0.12), hsl(var(--muted) / 0.08))",
          opacity: isHovered ? 1 : 0,
        }}
      />
      {isHovered && (
        <span
          className="absolute text-xs font-bold text-primary select-none"
          style={{ right: "-1.5%", top: "50%", transform: "translateY(-50%)" }}
        >
          &gt;&gt;&gt;
        </span>
      )}

      {/* Radio button icon */}
      <Circle
        className="absolute text-primary"
        style={{
          left: `calc(${priceCenterX - region.x_pct}% + 2.5%)`,
          top: `${priceCenterY - region.y_pct}%`,
          transform: "translate(-50%, -50%)",
        }}
        size={16}
      />

      {/* Shopping cart icon with popup */}
      <div
        className="absolute"
        style={{
          left: `calc(${priceCenterX - region.x_pct}% + 5.5%)`,
          top: `${priceCenterY - region.y_pct}%`,
          transform: "translate(-50%, -50%)",
        }}
      >
        <ShoppingCart className="text-primary cursor-pointer" size={16} />
        {isHovered && <ProductPopup region={region} />}
      </div>
    </div>
  );
});

RegionBox.displayName = "RegionBox";

const PdfPageOverlay = ({ regions }: PdfPageOverlayProps) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  if (regions.length === 0) return null;

  return (
    <>
      {regions.map((region) => (
        <RegionBox
          key={region.id}
          region={region}
          hoveredId={hoveredId}
          setHoveredId={setHoveredId}
        />
      ))}
    </>
  );
};

export default PdfPageOverlay;
