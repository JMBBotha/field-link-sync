import { useState } from "react";
import { calcSellingPrice } from "@/lib/pricing";
import { Info, X, ImageIcon, Sparkles, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProductAiDescription } from "@/hooks/useProductAiDescription";
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
  /** Controlled open state — when provided, Dialog is controlled externally */
  open?: boolean;
  /** Callback when controlled Dialog open state changes */
  onOpenChange?: (open: boolean) => void;
}

export default function ProductInfoDialog({ product, onMarkupSaved, open: controlledOpen, onOpenChange }: ProductInfoDialogProps) {
  const { isAdmin } = useRole();
  const btu = detectBTU(product);
  const initialMarkup = (product as any).default_markup_percent ?? (product as any).markup_percent ?? 20;
  const costPrice = product.cost_price || product.cost_excl_vat || 0;
  const kW = extractKW(product);
  const phase = extractPhase(product);
  const imageUrl = (product as any).image_url;

  const [markup, setMarkup] = useState(initialMarkup);
  const [saving, setSaving] = useState(false);
  const aiDescription = useProductAiDescription(
    product.id,
    (product as any).ai_sales_description,
    (product as any).ai_sales_description_generated_at
  );
  const sellingPrice = costPrice > 0 ? Math.round(costPrice * (1 + markup / 100) * 100) / 100 : (product.selling_price || 0);
  const markupPercent = costPrice > 0 ? markup : (product.selling_price && costPrice > 0 ? ((product.selling_price / costPrice) - 1) * 100 : 0);
  const pricing = { sellingPrice, markupPercent };

  const handleSaveMarkup = async () => {
    if (costPrice <= 0) return;
    setSaving(true);
    const { error } = await supabase
      .from("supplier_products")
      .update({ default_markup_percent: markup } as any)
      .eq("id", product.id);
    setSaving(false);
    if (error) {
      toast.error("Failed to update markup");
    } else {
      toast.success("Markup updated");
      const { sellingExclVat } = calcSellingPrice(costPrice, markup);
      onMarkupSaved?.(product.id, Math.round(sellingExclVat * 100) / 100);
    }
  };

  const isControlled = controlledOpen !== undefined;

  return (
    <Dialog open={isControlled ? controlledOpen : undefined} onOpenChange={isControlled ? onOpenChange : undefined}>
      {!isControlled && (
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
      )}
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

              {/* AI sales description — generated once and cached in the DB, reused on every future quote/estimate */}
              <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Sparkles className="h-3.5 w-3.5" />
                    Sales Description
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs gap-1"
                    disabled={aiDescription.isLoading}
                    onClick={() => (aiDescription.description ? aiDescription.regenerate() : aiDescription.generate())}
                  >
                    <RefreshCw className={cn("h-3 w-3", aiDescription.isLoading && "animate-spin")} />
                    {aiDescription.isLoading ? "Generating..." : aiDescription.description ? "Regenerate" : "Generate"}
                  </Button>
                </div>
                {aiDescription.description ? (
                  <p className="text-xs leading-relaxed">{aiDescription.description}</p>
                ) : aiDescription.error ? (
                  <p className="text-xs text-destructive">{aiDescription.error.message || "Failed to generate description"}</p>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No sales description yet — click Generate to write one with AI.</p>
                )}
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
                        → {formatZAR(calcSellingPrice(costPrice, markup).sellingExclVat)}
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
