import { useState } from "react";
import { Info, X } from "lucide-react";
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
  // Prefer explicit kw column if available
  if ((product as any).kw) return `${(product as any).kw} kW`;
  const text = [product.short_name, product.description, product.product_code].join(" ");
  const match = text.match(/(\d+(?:\.\d+)?)\s*kw/i);
  return match ? `${match[1]} kW` : null;
}

/** Attempt to detect phase from product text */
function extractPhase(product: PaletteProduct): string {
  // Prefer explicit phase column if available
  if ((product as any).phase === "three") return "3 Phase";
  if ((product as any).phase === "single") return "Single Phase";
  const text = [product.short_name, product.description, product.product_code].join(" ").toLowerCase();
  if (text.includes("3 phase") || text.includes("3-phase") || text.includes("three phase") || text.includes("3ph")) return "3 Phase";
  return "Single Phase";
}

interface ProductInfoDialogProps {
  product: PaletteProduct;
  /** Optional callback when markup is saved so parent can update local state */
  onMarkupSaved?: (productId: string, newSellingPrice: number) => void;
}

export default function ProductInfoDialog({ product, onMarkupSaved }: ProductInfoDialogProps) {
  const { isAdmin } = useRole();
  const btu = detectBTU(product);
  const costPrice = product.cost_excl_vat || 0;
  const sellingPrice = product.selling_price || 0;
  const currentMarkup = costPrice > 0 ? ((sellingPrice - costPrice) / costPrice) * 100 : 0;
  const kW = extractKW(product);
  const phase = extractPhase(product);

  const [markup, setMarkup] = useState(Math.round(currentMarkup * 100) / 100);
  const [saving, setSaving] = useState(false);

  const handleSaveMarkup = async () => {
    if (costPrice <= 0) return;
    setSaving(true);
    const newSelling = Math.round(costPrice * (1 + markup / 100) * 100) / 100;
    const { error } = await supabase
      .from("supplier_products")
      .update({ selling_price: newSelling })
      .eq("id", product.id);
    setSaving(false);
    if (error) {
      toast.error("Failed to update markup");
    } else {
      toast.success("Markup updated");
      product.selling_price = newSelling;
      onMarkupSaved?.(product.id, newSelling);
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="h-5 w-5 rounded-full flex items-center justify-center hover:bg-accent shrink-0"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Info className="h-3 w-3 text-muted-foreground" />
        </button>
      </DialogTrigger>
      {/* z-[9999] on both overlay and content to render above the wizard (z-[60]) */}
      <DialogPortal>
        <DialogOverlay className="z-[9999]" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-[50%] top-[50%] z-[9999] grid w-full max-w-sm translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg"
          )}
          onClick={(e) => e.stopPropagation()}
        >
        <DialogHeader>
          <DialogTitle className="text-sm">
            {product.short_name || product.product_code}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-xs">
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
            {(product as any).name && (
              <>
                <span className="text-muted-foreground">Name</span>
                <span>{(product as any).name}</span>
              </>
            )}
            <span className="text-muted-foreground">Model</span>
            <span className="font-mono font-medium">{(product as any).model || product.product_code}</span>
            <span className="text-muted-foreground">Brand</span>
            <span>{product.brand || "—"}</span>
            <span className="text-muted-foreground">BTU Rating</span>
            <span>{btu.toLocaleString()}</span>
            {product.pipe_size && (
              <>
                <span className="text-muted-foreground">Pipe Sizes</span>
                <span>{product.pipe_size}</span>
              </>
            )}
            {((product as any).pipe_liquid || (product as any).pipe_gas) && (
              <>
                {(product as any).pipe_liquid && (
                  <>
                    <span className="text-muted-foreground">Pipe Liquid</span>
                    <span>{(product as any).pipe_liquid}</span>
                  </>
                )}
                {(product as any).pipe_gas && (
                  <>
                    <span className="text-muted-foreground">Pipe Gas</span>
                    <span>{(product as any).pipe_gas}</span>
                  </>
                )}
              </>
            )}
            {kW && (
              <>
                <span className="text-muted-foreground">kW Rating</span>
                <span>{kW}</span>
              </>
            )}
            <span className="text-muted-foreground">Phase</span>
            <span>{phase}</span>
            <span className="text-muted-foreground">Description</span>
            <span className="break-words">{product.description || "—"}</span>
            <span className="text-muted-foreground">Supplier</span>
            <span>{product.supplier_name || "—"}</span>
          </div>

          <Separator />

          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
            <span className="text-muted-foreground">Cost Price</span>
            <span>{formatZAR(costPrice)}</span>
            <span className="text-muted-foreground">Selling Price</span>
            <span className="font-medium">{formatZAR(sellingPrice)}</span>
            <span className="text-muted-foreground">Markup %</span>
            <span>{currentMarkup.toFixed(1)}%</span>
          </div>

          {isAdmin && (
            <>
              <Separator />
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Change Markup % (Admin)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={markup}
                    onChange={(e) => setMarkup(parseFloat(e.target.value) || 0)}
                    className="h-7 text-xs w-20"
                    step={1}
                    min={0}
                  />
                  <span className="text-muted-foreground text-xs">
                    → {formatZAR(costPrice * (1 + markup / 100))}
                  </span>
                  <button
                    className="ml-auto text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
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
          <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
