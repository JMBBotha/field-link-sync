import { memo, useState, useRef, useCallback, useEffect } from "react";
import type { PaletteProduct, Basket } from "../QuoteBuilderTab";
import type { WizardTriggerItem } from "./QuoteBuilderPopup";
import type { PdfSelectionHandlers } from "@/types/pdfSelection";
import { ShoppingCart, Check, Sparkles, ChevronsRight, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatRand } from "@/utils/formatRand";

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

interface InfoCardProps {
  region: OverlayRegion;
  showAbove: boolean;
}

const InfoCard = memo(({ region, showAbove }: InfoCardProps) => {
  const product = region.product as any;
  const isMatched = !!region.matched || !!region.product;

  return (
    <div
      className="absolute left-1/2 z-50 max-w-xs w-64 bg-white dark:bg-card rounded-lg shadow-xl border border-border p-3 text-sm animate-fade-in pointer-events-none"
      style={{
        transform: "translateX(-50%)",
        ...(showAbove ? { bottom: "100%", marginBottom: 6 } : { top: "100%", marginTop: 6 }),
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <p className="font-bold text-foreground truncate text-xs leading-tight">
          {region.label}
        </p>
        <Badge
          variant={isMatched ? "default" : "secondary"}
          className={`text-[10px] px-1.5 py-0 shrink-0 ${
            isMatched
              ? "bg-green-500/90 text-white border-green-600"
              : "bg-orange-400/90 text-white border-orange-500"
          }`}
        >
          {isMatched ? "Matched" : "New"}
        </Badge>
      </div>

      {/* Model code */}
      <p className="font-mono text-[11px] text-muted-foreground mb-2">
        {region.product_code}
      </p>

      {/* Prices grid */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-border pt-2">
        {region.detected_price != null && (
          <div>
            <p className="text-[10px] text-muted-foreground">PDF Price</p>
            <p className="font-semibold text-xs">{formatRand(region.detected_price)}</p>
          </div>
        )}
        {product?.cost_price != null && (
          <div>
            <p className="text-[10px] text-muted-foreground">Cost Price</p>
            <p className="font-semibold text-xs">{formatRand(product.cost_price)}</p>
          </div>
        )}
        {product?.selling_price != null && (
          <div>
            <p className="text-[10px] text-muted-foreground">Selling Price</p>
            <p className="font-semibold text-xs text-primary">{formatRand(product.selling_price)}</p>
          </div>
        )}
      </div>

      {/* Category + BTU */}
      {(product?.category || product?.btu_rating) && (
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          {product?.category && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {product.category}
            </Badge>
          )}
          {product?.btu_rating && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {product.btu_rating} BTU
            </Badge>
          )}
        </div>
      )}

      {/* AI detected */}
      <div className="flex items-center gap-1 mt-2 text-[10px] text-muted-foreground">
        <Sparkles className="h-3 w-3 text-amber-500" />
        <span>AI Detected</span>
      </div>
    </div>
  );
});
InfoCard.displayName = "InfoCard";

const RegionBox = memo(
  ({
    region,
    isSelected,
    onToggleSelect,
    onRowClick,
    onInfoClick,
    basketCount,
    onHoverStart,
    onHoverMove,
    onHoverEnd,
  }: {
    region: OverlayRegion;
    isSelected: boolean;
    onToggleSelect: () => void;
    onRowClick: () => void;
    onInfoClick: () => void;
    basketCount: number;
    onHoverStart?: (product: PaletteProduct | null, e: React.MouseEvent) => void;
    onHoverMove?: (e: React.MouseEvent) => void;
    onHoverEnd?: () => void;
  }) => {
    const [hovered, setHovered] = useState(false);
    const [showCard, setShowCard] = useState(false);
    const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const rowRef = useRef<HTMLDivElement>(null);
    const [showAbove, setShowAbove] = useState(true);

    const handleMouseEnter = useCallback(
      (e: React.MouseEvent) => {
        setHovered(true);
        onHoverStart?.(region.product, e);
        // Determine if card should show above or below
        if (rowRef.current) {
          const rect = rowRef.current.getBoundingClientRect();
          setShowAbove(rect.top > 200);
        }
        hoverTimer.current = setTimeout(() => setShowCard(true), 300);
      },
      [region.product, onHoverStart]
    );

    const handleMouseMove = useCallback(
      (e: React.MouseEvent) => {
        onHoverMove?.(e);
      },
      [onHoverMove]
    );

    const handleMouseLeave = useCallback(() => {
      setHovered(false);
      setShowCard(false);
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      onHoverEnd?.();
    }, [onHoverEnd]);

    useEffect(() => {
      return () => {
        if (hoverTimer.current) clearTimeout(hoverTimer.current);
      };
    }, []);

    return (
      <div
        ref={rowRef}
        className="absolute"
        style={{
          left: "0%",
          top: `${region.y_pct}%`,
          width: "100%",
          height: `${region.h_pct}%`,
        }}
        onMouseEnter={handleMouseEnter}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Gradient overlay — stops before the gutter */}
        <div
          className="absolute inset-0 transition-all duration-200 rounded-sm"
          style={{
            right: 56,
            background: hovered
              ? "linear-gradient(to right, transparent, rgba(59,130,246,0.25))"
              : "linear-gradient(to right, transparent, rgba(59,130,246,0.15))",
          }}
        />

        {/* Click area for row (content area, excludes gutter) */}
        <div
          className="absolute inset-0 cursor-pointer z-[5]"
          style={{ right: 56 }}
          onClick={onRowClick}
        />

        {/* Right gutter strip — unified control group */}
        <div
          className="absolute top-0 bottom-0 z-10 flex items-center justify-center"
          style={{ right: -72, width: 68 }}
        >
          {/* Cart badge (floats before group) */}
          {basketCount > 0 && (
            <div className="relative shrink-0 mr-1.5">
              <ShoppingCart className="h-3.5 w-3.5 text-primary" />
              <span className="absolute -top-1.5 -right-1.5 bg-primary text-primary-foreground text-[9px] font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none">
                {basketCount}
              </span>
            </div>
          )}

          {/* Unified group: >>> | info | radio */}
          <div className="flex items-center" style={{ gap: 6 }}>
            {/* Three chevron arrows */}
            <span
              className="text-primary font-bold text-xs shrink-0 transition-opacity duration-150 select-none"
              style={{ opacity: hovered ? 1 : 0.6, letterSpacing: -1 }}
            >
              &rsaquo;&rsaquo;&rsaquo;
            </span>

            {/* Info icon */}
            <button
              className="flex items-center justify-center w-4 h-4 shrink-0 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                onInfoClick();
              }}
            >
              <Info className="h-3.5 w-3.5 text-primary opacity-70 hover:opacity-100 transition-opacity" />
            </button>

            {/* Radio button */}
            <button
              className="flex items-center justify-center w-4 h-4 shrink-0 rounded-full border-2 transition-colors duration-150"
              style={{
                borderColor: isSelected ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                backgroundColor: isSelected ? "hsl(var(--primary))" : "hsl(var(--background))",
              }}
              onClick={(e) => {
                e.stopPropagation();
                onToggleSelect();
              }}
            >
              {isSelected && <Check className="h-2.5 w-2.5 text-primary-foreground" strokeWidth={3} />}
            </button>
          </div>
        </div>

        {/* Info popup card */}
        {showCard && <InfoCard region={region} showAbove={showAbove} />}
      </div>
    );
  }
);
RegionBox.displayName = "RegionBox";

const PdfPageOverlay = ({
  regions,
  baskets,
  onAddProductToBasket,
  basketProductCounts,
  onOpenProductInfo,
  onQuickAddProduct,
  onHoverStart,
  onHoverMove,
  onHoverEnd,
  pdfSelection,
}: PdfPageOverlayProps) => {
  // Local selection state fallback if pdfSelection not provided
  const [localSelected, setLocalSelected] = useState<Set<string>>(new Set());

  const isSelected = useCallback(
    (region: OverlayRegion) => {
      if (pdfSelection) {
        return pdfSelection.selectedFromPdf.some((s) => s.code === region.product_code);
      }
      return localSelected.has(region.id);
    },
    [pdfSelection, localSelected]
  );

  const toggleSelect = useCallback(
    (region: OverlayRegion) => {
      // Radio = add to quote
      if (pdfSelection) {
        const alreadySelected = pdfSelection.selectedFromPdf.some(
          (s) => s.code === region.product_code
        );
        if (alreadySelected) {
          pdfSelection.setSelectedFromPdf((prev) =>
            prev.filter((s) => s.code !== region.product_code)
          );
        } else {
          pdfSelection.handleSelectProduct({
            code: region.product_code,
            description: region.label,
            price: region.detected_price != null ? String(region.detected_price) : "0",
            costPrice: (region.product as any)?.cost_price,
            markupPercent: (region.product as any)?.default_markup_percent,
          });
        }
      } else if (region.product && onAddProductToBasket && baskets.length > 0) {
        onAddProductToBasket(baskets[0].id, region.product);
      } else if (onQuickAddProduct) {
        onQuickAddProduct(region.label, region.product_code, region.detected_price ?? null);
      }

      // Toggle local state too
      setLocalSelected((prev) => {
        const next = new Set(prev);
        if (next.has(region.id)) next.delete(region.id);
        else next.add(region.id);
        return next;
      });
    },
    [pdfSelection, onAddProductToBasket, onQuickAddProduct, baskets]
  );

  const handleRowClick = useCallback(
    (region: OverlayRegion) => {
      if (region.product && onOpenProductInfo) {
        onOpenProductInfo(region.product);
      } else if (onQuickAddProduct) {
        onQuickAddProduct(region.label, region.product_code, region.detected_price ?? null);
      }
    },
    [onOpenProductInfo, onQuickAddProduct]
  );

  const handleInfoClick = useCallback(
    (region: OverlayRegion) => {
      if (region.product && onOpenProductInfo) {
        onOpenProductInfo(region.product);
      }
    },
    [onOpenProductInfo]
  );

  if (regions.length === 0) return null;

  return (
    <>
      {regions.map((region) => {
        const basketCount =
          basketProductCounts?.[region.product_code] ??
          basketProductCounts?.[region.id] ??
          0;
        return (
          <RegionBox
            key={region.id}
            region={region}
            isSelected={isSelected(region) || basketCount > 0}
            onToggleSelect={() => toggleSelect(region)}
            onRowClick={() => handleRowClick(region)}
            onInfoClick={() => handleInfoClick(region)}
            basketCount={basketCount}
            onHoverStart={onHoverStart}
            onHoverMove={onHoverMove}
            onHoverEnd={onHoverEnd}
          />
        );
      })}
    </>
  );
};

export default PdfPageOverlay;
