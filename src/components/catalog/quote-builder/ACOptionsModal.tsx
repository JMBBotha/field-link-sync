import { useState, useMemo, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Snowflake, Info } from "lucide-react";
import type { PaletteProduct } from "../QuoteBuilderTab";
import { getProductDisplayName } from "./productDisplayUtils";
import { computeProductPricing } from "@/lib/pricing";

interface ACOptionsModalProps {
  open: boolean;
  onClose: () => void;
  products: PaletteProduct[];
  initialProduct?: PaletteProduct | null;
  onConfirm: (product: PaletteProduct) => void;
  inferredBrand?: string | null;
  inferredType?: string | null;
}

const BTU_SIZES = [9000, 12000, 18000, 24000, 30000, 36000, 42000, 48000, 60000, 76000];

const AC_TYPES = ["Wall Mount", "Cassette", "Ducted", "Floor Standing", "Ceiling", "Portable"];

function extractBTU(p: PaletteProduct): number | null {
  const desc = `${p.description || ""} ${p.short_name || ""} ${p.product_code || ""}`.toLowerCase();
  for (const btu of [...BTU_SIZES].reverse()) {
    const kBtu = btu / 1000;
    if (desc.includes(`${btu}`) || desc.includes(`${kBtu}k`) || desc.includes(`${kBtu}000`)) return btu;
  }
  return null;
}

function extractACType(p: PaletteProduct): string | null {
  return detectACType(p);
}

/**
 * Type filter when the AC options modal opens.
 * A type inferred from units already on the quote is never applied: that hid
 * cassettes whenever a mid-wall was on the quote. The user's own pick is kept.
 */
export function acTypeFilterDefault(explicitType: string | null | undefined): string {
  const chosen = (explicitType || "").trim();
  return chosen || "all";
}


function ModelList({ products, selectedProductId, onSelect }: {
  products: PaletteProduct[];
  selectedProductId: string;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (selectedRef.current && containerRef.current) {
      selectedRef.current.scrollIntoView({ block: "center", behavior: "instant" });
    }
  }, [selectedProductId, products]);

  if (products.length === 0) {
    return <div className="max-h-48 overflow-y-auto border rounded-md p-1.5">
      <p className="text-xs text-muted-foreground text-center py-4">No matching models</p>
    </div>;
  }

  return (
    <div ref={containerRef} className="max-h-48 overflow-y-auto space-y-1 border rounded-md p-1.5">
      {products.map((p) => {
        const price = computeProductPricing(p).sellExVat;
        const isSelected = selectedProductId === p.id;
        return (
          <button
            key={p.id}
            ref={isSelected ? selectedRef : undefined}
            className={`w-full flex items-center gap-2 rounded-md p-2 text-left text-xs transition-colors ${
              isSelected ? "bg-primary/10 border border-primary/30" : "hover:bg-muted border border-transparent"
            }`}
            onClick={() => onSelect(p.id)}
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium truncate">{getProductDisplayName(p)}</p>
              <p className="text-xs font-mono font-medium text-primary/80 truncate">{p.product_code}</p>
            </div>
            <span className="font-bold shrink-0">
              {price > 0 ? `R${price.toLocaleString("en-ZA")}` : "POR"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const ACOptionsModal = ({ open, onClose, products, initialProduct, onConfirm, inferredBrand, inferredType }: ACOptionsModalProps) => {
  const acProducts = useMemo(
    () => products.filter((p) => p.product_category === "Air Conditioning"),
    [products]
  );

  const brands = useMemo(() => {
    const set = new Set<string>();
    acProducts.forEach((p) => { if (p.brand) set.add(p.brand); });
    return [...set].sort();
  }, [acProducts]);

  // Brand still follows the quote. Type does not: a mid-wall already on the
  // quote must not hide cassettes. An explicit type pick is remembered.
  const explicitTypeRef = useRef<string | null>(null);
  const defaultBrand = initialProduct?.brand || inferredBrand || "all";

  const [selectedBrand, setSelectedBrand] = useState<string>(defaultBrand);
  const [selectedBTU, setSelectedBTU] = useState<string>("all");
  const [selectedType, setSelectedType] = useState<string>("all");
  const [selectedProductId, setSelectedProductId] = useState<string>(initialProduct?.id || "");

  const chooseType = (value: string) => {
    explicitTypeRef.current = value;
    setSelectedType(value);
    setSelectedProductId("");
  };

  // Reset brand, size and the highlighted row only when the modal opens.
  // Type stays All, or the user's last explicit pick — never the inferred type.
  // A later change to the quote's units must not snap the filter back.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (!justOpened) return;
    setSelectedBrand(initialProduct?.brand || inferredBrand || "all");
    const clickedBTU = initialProduct ? extractBTU(initialProduct) : null;
    setSelectedBTU(clickedBTU ? String(clickedBTU) : "all");
    setSelectedType(acTypeFilterDefault(explicitTypeRef.current));
    setSelectedProductId(initialProduct?.id || "");
  }, [open, inferredBrand, initialProduct]);

  const filteredProducts = useMemo(() => {
    return acProducts.filter((p) => {
      if (selectedBrand !== "all" && p.brand !== selectedBrand) return false;
      if (selectedBTU !== "all") {
        const btu = extractBTU(p);
        if (!btu || btu !== Number(selectedBTU)) return false;
      }
      if (selectedType !== "all") {
        const type = extractACType(p);
        if (type !== selectedType) return false;
      }
      return true;
    });
  }, [acProducts, selectedBrand, selectedBTU, selectedType]);

  const availableBTUs = useMemo(() => {
    const btus = new Set<number>();
    const preFiltered = acProducts.filter((p) => {
      if (selectedBrand !== "all" && p.brand !== selectedBrand) return false;
      if (selectedType !== "all" && extractACType(p) !== selectedType) return false;
      return true;
    });
    preFiltered.forEach((p) => {
      const btu = extractBTU(p);
      if (btu) btus.add(btu);
    });
    return [...btus].sort((a, b) => a - b);
  }, [acProducts, selectedBrand, selectedType]);

  const availableTypes = useMemo(() => {
    const types = new Set<string>();
    const brandFiltered = selectedBrand === "all" ? acProducts : acProducts.filter((p) => p.brand === selectedBrand);
    brandFiltered.forEach((p) => {
      const t = extractACType(p);
      if (t) types.add(t);
    });
    return [...types].sort();
  }, [acProducts, selectedBrand]);

  const selectedProduct = filteredProducts.find((p) => p.id === selectedProductId) || filteredProducts[0] || null;

  const handleConfirm = () => {
    if (selectedProduct) {
      onConfirm(selectedProduct);
      onClose();
    }
  };

  const showInferenceBanner = inferredBrand && selectedBrand === inferredBrand;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Snowflake className="h-4 w-4 text-primary" />
            Select AC Unit
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Inference banner */}
          {showInferenceBanner && (
            <div className="flex items-center gap-2 rounded-md bg-primary/10 border border-primary/20 px-3 py-2">
              <Info className="h-3.5 w-3.5 text-primary shrink-0" />
              <p className="text-xs text-foreground">
                Based on your quote, suggesting <span className="font-semibold">{inferredBrand}</span> products. Change brand below if needed.
              </p>
            </div>
          )}

          {/* Brand */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Brand</label>
            <Select value={selectedBrand} onValueChange={(v) => { setSelectedBrand(v); setSelectedProductId(""); }}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="All brands" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Brands</SelectItem>
                {brands.map((b) => (
                  <SelectItem key={b} value={b}>{b}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Type */}
          {availableTypes.length > 0 && (
            <div className="space-y-1.5" data-inferred-type={inferredType || ""}>
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-muted-foreground">Unit Type</label>
                {selectedType !== "all" && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-medium text-foreground"
                    onClick={() => chooseType("all")}
                    aria-label={`Clear unit type ${selectedType}`}
                  >
                    {selectedType}
                    <span aria-hidden="true">×</span>
                  </button>
                )}
              </div>
              <Select value={selectedType} onValueChange={chooseType}>
                <SelectTrigger className="h-9 text-sm" aria-label="Unit type">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {availableTypes.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* BTU */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">BTU Size</label>
            <Select value={selectedBTU} onValueChange={(v) => { setSelectedBTU(v); setSelectedProductId(""); }}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="All sizes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sizes</SelectItem>
                {availableBTUs.map((btu) => (
                  <SelectItem key={btu} value={String(btu)}>
                    {(btu / 1000).toFixed(0)}K BTU ({(btu * 0.000293071).toFixed(1)} kW)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Model selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Model ({filteredProducts.length} available)
            </label>
            <ModelList
              products={filteredProducts}
              selectedProductId={selectedProductId}
              onSelect={setSelectedProductId}
            />
          </div>

          {/* Selected product preview */}
          {selectedProduct && (
            <div className="rounded-md bg-card text-foreground p-2.5 text-xs space-y-1">
              <p className="font-semibold text-foreground">{getProductDisplayName(selectedProduct)}</p>
              <p className="text-muted-foreground line-clamp-2">{selectedProduct.description}</p>
              <div className="flex gap-2 mt-1">
                <Badge variant="outline" className="text-xs">{selectedProduct.supplier_name}</Badge>
                <Badge variant="outline" className="text-xs">
                  R{computeProductPricing(selectedProduct).sellExVat.toLocaleString("en-ZA")}
                </Badge>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleConfirm} disabled={!selectedProduct}>
            Add to Zone
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ACOptionsModal;

// Export helper for use in QuoteBuilderTab
export function detectACType(p: PaletteProduct): string | null {
  // Category / unit_type win, so a cassette filed as "Cassette Inverter" stays
  // a cassette even when the printed row still says Under Ceiling.
  const filed = `${(p as { unit_type?: string | null }).unit_type || ""} ${p.category || ""}`.toLowerCase();
  if (filed.includes("cassette")) return "Cassette";
  if (/wall\s*mount|midwall|hi-?wall/.test(filed)) return "Wall Mount";
  if (filed.includes("duct")) return "Ducted";
  if (filed.includes("floor")) return "Floor Standing";
  if (filed.includes("ceiling")) return "Ceiling";
  if (filed.includes("portable")) return "Portable";
  const desc = `${p.description || ""} ${p.short_name || ""} ${p.product_code || ""}`.toLowerCase();
  if (desc.includes("wall") || desc.includes("split") || desc.includes("hi-wall") || desc.includes("hi wall") || desc.includes(" mw ") || desc.includes("midwall") || desc.endsWith(" mw") || desc.endsWith("mw wf") || /\bmw\b/.test(desc)) return "Wall Mount";
  if (desc.includes("cassette")) return "Cassette";
  if (desc.includes("ducted") || desc.includes("duct")) return "Ducted";
  if (desc.includes("floor")) return "Floor Standing";
  if (desc.includes("ceiling")) return "Ceiling";
  if (desc.includes("portable")) return "Portable";
  return null;
}
