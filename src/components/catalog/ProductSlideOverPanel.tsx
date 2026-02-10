import { useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { X, ChevronLeft, ChevronRight, Plus, Cpu, Wind, Ruler } from "lucide-react";

const formatZAR = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

interface Product {
  id: string;
  product_code: string;
  description: string;
  category: string;
  supplier_name: string;
  pipe_size: string | null;
  cost_price: number;
  selling_price: number;
  default_markup_percent: number;
  is_price_on_request: boolean;
  btu_rating: number | null;
  refrigerant_type: string | null;
  quote_usage_count: number;
  short_name?: string | null;
  rrp?: number | null;
}

interface Props {
  product: Product | null;
  open: boolean;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  currentIndex: number;
  totalCount: number;
  deriveBrand: (p: Product) => string;
  deriveSpeedType: (p: Product) => string;
  derivePhase: (p: Product) => string;
  onAddToQuote?: (item: { description: string; quantity: number; unit_price: number }) => void;
}

const ProductSlideOverPanel = ({
  product, open, onClose, onPrev, onNext,
  hasPrev, hasNext, currentIndex, totalCount,
  deriveBrand, deriveSpeedType, derivePhase, onAddToQuote,
}: Props) => {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === "Escape") onClose();
    if (e.key === "ArrowLeft" && hasPrev) onPrev();
    if (e.key === "ArrowRight" && hasNext) onNext();
  }, [open, onClose, onPrev, onNext, hasPrev, hasNext]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (!product) return null;

  const margin = product.selling_price - product.cost_price;
  const brand = deriveBrand(product);
  const speedType = deriveSpeedType(product);
  const phase = derivePhase(product);

  const specs = [
    { label: "BTU Rating", value: product.btu_rating ? `${(product.btu_rating / 1000).toFixed(0)}K (${product.btu_rating.toLocaleString()})` : "—" },
    { label: "Refrigerant", value: product.refrigerant_type || "—" },
    { label: "Speed Type", value: speedType || "—" },
    { label: "Phase", value: phase || "—" },
    { label: "Pipe Size", value: product.pipe_size || "—" },
    { label: "Brand", value: brand },
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 z-50 h-full w-[400px] max-w-[90vw] bg-card border-l shadow-2xl transform transition-transform duration-300 ease-in-out ${
          open ? "translate-x-0" : "translate-x-full"
        } flex flex-col`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <span className="text-xs text-muted-foreground">
            {currentIndex + 1} of {totalCount}
          </span>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Title */}
          <div>
            {product.short_name && (
              <p className="text-lg font-bold text-primary mb-1">{product.short_name}</p>
            )}
            <p className="text-base font-mono font-semibold">{product.product_code}</p>
          </div>

          {/* Description */}
          <p className="text-sm text-muted-foreground leading-relaxed">{product.description}</p>

          {/* Tags */}
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline">{product.category}</Badge>
            {product.btu_rating && (
              <Badge variant="outline" className="gap-1">
                <Cpu className="h-3 w-3" /> {(product.btu_rating / 1000).toFixed(0)}K BTU
              </Badge>
            )}
            {product.refrigerant_type && (
              <Badge variant="outline" className="gap-1">
                <Wind className="h-3 w-3" /> {product.refrigerant_type}
              </Badge>
            )}
            {product.pipe_size && (
              <Badge variant="outline" className="gap-1">
                <Ruler className="h-3 w-3" /> {product.pipe_size}
              </Badge>
            )}
          </div>

          <Separator />

          {/* Specs Grid */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Specifications</h4>
            <div className="grid grid-cols-2 gap-3">
              {specs.map((s) => (
                <div key={s.label} className="bg-muted/30 rounded-lg p-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">{s.label}</p>
                  <p className="text-sm font-medium">{s.value}</p>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Pricing */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Pricing</h4>
            {product.is_price_on_request ? (
              <p className="text-sm font-semibold text-muted-foreground">Price on Request</p>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-muted/30 rounded-lg p-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Cost</p>
                  <p className="text-sm font-medium">{formatZAR(product.cost_price)}</p>
                </div>
                <div className="bg-muted/30 rounded-lg p-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Selling</p>
                  <p className="text-sm font-bold text-primary">{formatZAR(product.selling_price)}</p>
                </div>
                <div className="bg-muted/30 rounded-lg p-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Margin</p>
                  <p className={`text-sm font-bold ${margin > 0 ? "text-green-500" : "text-destructive"}`}>
                    {formatZAR(margin)}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Add to quote */}
          {onAddToQuote && !product.is_price_on_request && (
            <>
              <Separator />
              <Button
                className="w-full"
                onClick={() => {
                  onAddToQuote({
                    description: `${product.product_code} - ${product.description}`,
                    quantity: 1,
                    unit_price: product.selling_price,
                  });
                  onClose();
                }}
              >
                <Plus className="h-4 w-4 mr-2" /> Add to Quote
              </Button>
            </>
          )}
        </div>

        {/* Footer Nav */}
        <div className="border-t p-3 flex items-center justify-between">
          <Button size="sm" variant="outline" disabled={!hasPrev} onClick={onPrev}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Previous
          </Button>
          <Button size="sm" variant="outline" disabled={!hasNext} onClick={onNext}>
            Next <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>
    </>
  );
};

export default ProductSlideOverPanel;
