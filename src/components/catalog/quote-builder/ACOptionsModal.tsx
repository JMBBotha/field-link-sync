import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Snowflake } from "lucide-react";
import type { PaletteProduct } from "../QuoteBuilderTab";

interface ACOptionsModalProps {
  open: boolean;
  onClose: () => void;
  products: PaletteProduct[];
  initialProduct?: PaletteProduct | null;
  onConfirm: (product: PaletteProduct) => void;
}

const BTU_SIZES = [9000, 12000, 18000, 24000, 30000, 36000, 42000, 48000, 60000, 76000];

function extractBTU(p: PaletteProduct): number | null {
  const desc = `${p.description || ""} ${p.short_name || ""} ${p.product_code || ""}`.toLowerCase();
  for (const btu of [...BTU_SIZES].reverse()) {
    const kBtu = btu / 1000;
    if (desc.includes(`${btu}`) || desc.includes(`${kBtu}k`) || desc.includes(`${kBtu}000`)) return btu;
  }
  return null;
}

const ACOptionsModal = ({ open, onClose, products, initialProduct, onConfirm }: ACOptionsModalProps) => {
  const acProducts = useMemo(
    () => products.filter((p) => p.product_category === "Air Conditioning"),
    [products]
  );

  const brands = useMemo(() => {
    const set = new Set<string>();
    acProducts.forEach((p) => { if (p.brand) set.add(p.brand); });
    return [...set].sort();
  }, [acProducts]);

  const [selectedBrand, setSelectedBrand] = useState<string>(initialProduct?.brand || "all");
  const [selectedBTU, setSelectedBTU] = useState<string>("all");
  const [selectedProductId, setSelectedProductId] = useState<string>(initialProduct?.id || "");

  const filteredProducts = useMemo(() => {
    return acProducts.filter((p) => {
      if (selectedBrand !== "all" && p.brand !== selectedBrand) return false;
      if (selectedBTU !== "all") {
        const btu = extractBTU(p);
        if (!btu || btu !== Number(selectedBTU)) return false;
      }
      return true;
    });
  }, [acProducts, selectedBrand, selectedBTU]);

  const availableBTUs = useMemo(() => {
    const btus = new Set<number>();
    const brandFiltered = selectedBrand === "all" ? acProducts : acProducts.filter((p) => p.brand === selectedBrand);
    brandFiltered.forEach((p) => {
      const btu = extractBTU(p);
      if (btu) btus.add(btu);
    });
    return [...btus].sort((a, b) => a - b);
  }, [acProducts, selectedBrand]);

  const selectedProduct = filteredProducts.find((p) => p.id === selectedProductId) || filteredProducts[0] || null;

  const handleConfirm = () => {
    if (selectedProduct) {
      onConfirm(selectedProduct);
      onClose();
    }
  };

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
            <div className="max-h-48 overflow-y-auto space-y-1 border rounded-md p-1.5">
              {filteredProducts.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">No matching models</p>
              ) : (
                filteredProducts.map((p) => {
                  const price = p.selling_price || p.cost_incl_vat || 0;
                  const isSelected = selectedProductId === p.id;
                  return (
                    <button
                      key={p.id}
                      className={`w-full flex items-center gap-2 rounded-md p-2 text-left text-xs transition-colors ${
                        isSelected ? "bg-primary/10 border border-primary/30" : "hover:bg-muted border border-transparent"
                      }`}
                      onClick={() => setSelectedProductId(p.id)}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{p.brand} {p.short_name || p.product_code}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{p.product_code}</p>
                      </div>
                      <span className="font-bold shrink-0">
                        {price > 0 ? `R${price.toLocaleString("en-ZA")}` : "POR"}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Selected product preview */}
          {selectedProduct && (
            <div className="rounded-md bg-muted/50 p-2.5 text-xs space-y-1">
              <p className="font-semibold text-foreground">{selectedProduct.brand} {selectedProduct.short_name || selectedProduct.product_code}</p>
              <p className="text-muted-foreground line-clamp-2">{selectedProduct.description}</p>
              <div className="flex gap-2 mt-1">
                <Badge variant="outline" className="text-[10px]">{selectedProduct.supplier_name}</Badge>
                <Badge variant="outline" className="text-[10px]">
                  R{(selectedProduct.selling_price || selectedProduct.cost_incl_vat || 0).toLocaleString("en-ZA")}
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
