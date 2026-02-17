import { useEffect, useCallback, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { X, ChevronLeft, ChevronRight, Plus, Cpu, Wind, Ruler, Upload, ImageIcon, Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

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
  image_url?: string | null;
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

  const { toast } = useToast();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [enhancingImage, setEnhancingImage] = useState(false);
  const [localImageUrl, setLocalImageUrl] = useState<string | null>(null);

  useEffect(() => {
    setLocalImageUrl(product?.image_url || null);
  }, [product?.id, product?.image_url]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !product) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Image too large", description: "Max 5MB", variant: "destructive" });
      return;
    }
    setUploadingImage(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${product.id}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("product-images")
        .upload(path, file, { contentType: file.type, upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(path);
      const imageUrl = urlData.publicUrl;
      await (supabase.from("supplier_products") as any)
        .update({ image_url: imageUrl })
        .eq("id", product.id);
      setLocalImageUrl(imageUrl);
      toast({ title: "Image uploaded" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploadingImage(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  };

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

          {/* Product Image */}
          <div className="flex items-center gap-3">
            {localImageUrl ? (
              <div className="w-24 h-24 rounded-lg overflow-hidden border bg-muted/20 shrink-0">
                <img src={localImageUrl} alt="" className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="w-24 h-24 rounded-lg border border-dashed bg-muted/10 flex items-center justify-center shrink-0">
                <ImageIcon className="h-8 w-8 text-muted-foreground/30" />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
              <Button
                variant="outline"
                size="sm"
                className="text-xs gap-1"
                onClick={() => imageInputRef.current?.click()}
                disabled={uploadingImage}
              >
                {uploadingImage ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                {localImageUrl ? "Replace Image" : "Upload Image"}
              </Button>
              {localImageUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs gap-1"
                  disabled={enhancingImage}
                  onClick={async () => {
                    if (!product || !localImageUrl) return;
                    setEnhancingImage(true);
                    try {
                      const { data, error } = await supabase.functions.invoke("enhance-image", {
                        body: { image_url: localImageUrl },
                      });
                      if (error) throw error;
                      if (!data?.enhanced_url) throw new Error("No enhanced URL returned");
                      await (supabase.from("supplier_products") as any)
                        .update({ image_url: data.enhanced_url })
                        .eq("id", product.id);
                      setLocalImageUrl(data.enhanced_url);
                      toast({ title: "Image enhanced" });
                    } catch (err: any) {
                      toast({ title: "Enhancement failed", description: err.message, variant: "destructive" });
                    } finally {
                      setEnhancingImage(false);
                    }
                  }}
                >
                  {enhancingImage ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  Enhance
                </Button>
              )}
            </div>
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
