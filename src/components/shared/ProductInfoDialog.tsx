import { useState } from "react";
import { calculatePricing } from "@/utils/pricing";
import { Info, X, ImageIcon } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogPortal,
  DialogOverlay,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useRole } from "@/hooks/useRole";
import type { PaletteProduct } from "@/components/catalog/QuoteBuilderTab";
import { detectBTU } from "@/components/catalog/quote-builder/quoteWizardTypes";

function formatZAR(value: number) {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(value);
}

/** Attempt to extract kW rating from product text */
function extractKW(product: PaletteProduct): string | null {
  if ((product as any).kw) return `${(product as any).kw} kW`;
  const text = [product.short_name, product.description, product.product_code].join(" ");
  const match = text.match(/(\d+(?:\.\d+)?)\s*kw/i);
  return match ? `${match[1]} kW` : null;
}

/** Attempt to detect phase from product text */
function extractPhase(product: PaletteProduct): string {
  if ((product as any).phase === "three") return "3 Phase";
  if ((product as any).phase === "single") return "Single Phase";
  const text = [product.short_name, product.description, product.product_code].join(" ").toLowerCase();
  if (text.includes("3 phase") || text.includes("3-phase") || text.includes("three phase") || text.includes("3ph")) return "3 Phase";
  return "Single Phase";
}

/** Info row component for clean grid layout */
function InfoRow({ label, value, mono }: { label: string; value: string | number | null | undefined; mono?: boolean }) {
  if (!value && value !== 0) return null;
  return (
    <>
      <span className="text-muted-foreground text-xs py-1">{label}</span>
      <span className={cn("text-xs py-1 break-words", mono && "font-mono font-medium")}>{value}</span>
    </>
  );
}

interface ProductInfoDialogProps {
  product: PaletteProduct;
  onMarkupSaved?: (productId: string, newSellingPrice: number) => void;
}

export default function ProductInfoDialog({ product, onMarkupSaved }: ProductInfoDialogProps) {
  const { isAdmin } = useRole();
  const btu = detectBTU(product);
  const initialMarkup = (product as any).markup_percent ?? 20;
  const pricing = calculatePricing(
    product.cost_excl_vat || 0,
    product.supplier_discount_percent ?? 0,
    initialMarkup
  );
  const costPrice = pricing.discountedCost;
  const kW = extractKW(product);
  const phase = extractPhase(product);
  const imageUrl = (product as any).image_url;

  const [markup, setMarkup] = useState(initialMarkup);
  const [saving, setSaving] = useState(false);

  const handleSaveMarkup = async () => {
    if (costPrice <= 0) return;
    setSaving(true);
    const { error } = await supabase
      .from("supplier_products")
      .update({ markup_percent: markup } as any)
      .eq("id", product.id);
    setSaving(false);
    if (error) {
      toast.error("Failed to update markup");
    } else {
      toast.success("Markup updated");
      const updated = calculatePricing(product.cost_excl_vat || 0, product.supplier_discount_percent ?? 0, markup);
      onMarkupSaved?.(product.id, Math.round(updated.sellingPrice * 100) / 100);
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="h-6 w-6 rounded-full flex items-center justify-center hover:bg-accent shrink-0 min-h-[24px] min-w-[24px]"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Info className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </DialogTrigger>
      <DialogPortal>
        <DialogOverlay className="z-[9999]" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-[50%] top-[50%] z-[9999] grid w-full max-w-md translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-0 shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-xl overflow-hidden"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header with optional image */}
          <div className="relative">
            {imageUrl ? (
              <div className="h-32 bg-muted overflow-hidden">
                <img src={imageUrl} alt={product.short_name || product.product_code} className="w-full h-full object-contain" />
              </div>
            ) : (
              <div className="h-16 bg-muted/30 flex items-center justify-center">
                <ImageIcon className="h-6 w-6 text-muted-foreground/30" />
              </div>
            )}
            <DialogPrimitive.Close className="absolute right-3 top-3 rounded-full bg-background/80 backdrop-blur-sm p-1.5 opacity-80 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 shadow-sm">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </div>

          <ScrollArea className="max-h-[60vh]">
            <div className="px-6 pb-6 space-y-4">
              <DialogHeader className="p-0">
                <DialogTitle className="text-base leading-tight">
                  {product.short_name || product.product_code}
                </DialogTitle>
                {product.brand && (
                  <p className="text-xs text-muted-foreground">{product.brand}</p>
                )}
              </DialogHeader>

              {/* Product details grid */}
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 rounded-lg border bg-muted/20 p-3">
                <InfoRow label="Model" value={(product as any).model || product.product_code} mono />
                <InfoRow label="Brand" value={product.brand} />
                <InfoRow label="BTU Rating" value={btu.toLocaleString()} />
                {product.pipe_size && <InfoRow label="Pipe Sizes" value={product.pipe_size} />}
                {(product as any).pipe_liquid && <InfoRow label="Pipe Liquid" value={(product as any).pipe_liquid} />}
                {(product as any).pipe_gas && <InfoRow label="Pipe Gas" value={(product as any).pipe_gas} />}
                {kW && <InfoRow label="kW Rating" value={kW} />}
                <InfoRow label="Phase" value={phase} />
                <InfoRow label="Description" value={product.description} />
                <InfoRow label="Supplier" value={product.supplier_name} />
                {(product as any).name && <InfoRow label="Full Name" value={(product as any).name} />}
              </div>

              <Separator />

              {/* Pricing grid */}
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 rounded-lg border bg-muted/20 p-3">
                <InfoRow label="Cost Price" value={formatZAR(costPrice)} />
                <InfoRow label="Selling Price" value={formatZAR(pricing.sellingPrice)} />
                <InfoRow label="Markup %" value={`${pricing.markupPercent.toFixed(1)}%`} />
                {product.price_per_metre != null && product.price_per_metre > 0 && (
                  <InfoRow label="Price/m" value={formatZAR(product.price_per_metre)} />
                )}
              </div>

              {isAdmin && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <Label className="text-xs font-medium">Change Markup % (Admin)</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        value={markup}
                        onChange={(e) => setMarkup(parseFloat(e.target.value) || 0)}
                        className="h-8 text-xs w-20"
                        step={1}
                        min={0}
                      />
                      <span className="text-muted-foreground text-xs">
                        → {formatZAR(calculatePricing(costPrice, 0, markup).sellingPrice)}
                      </span>
                      <button
                        className="ml-auto text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                        onClick={handleSaveMarkup}
                        disabled={saving || costPrice <= 0}
                      >
                        {saving ? "..." : "Save"}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </ScrollArea>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
