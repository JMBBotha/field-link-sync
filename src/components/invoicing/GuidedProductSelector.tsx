import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft, ArrowRight, Search, Package, Zap, ZapOff, Check, Plus, Minus, Wind,
  Loader2, LayoutGrid
} from "lucide-react";
import Fuse from "fuse.js";

interface GuidedProductSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddItem: (item: { description: string; quantity: number; rate: number; amount: number }) => void;
}

interface CatalogProduct {
  id: string;
  product_code: string;
  description: string;
  category: string;
  selling_price: number;
  cost_price: number;
  btu_rating: number | null;
  unit_type: string | null;
  capacity_btu: number | null;
  inverter: boolean | null;
  model_range: string | null;
  is_price_on_request: boolean;
}

const unitTypes = [
  { value: "midwall", label: "Midwall Split", icon: "🏠" },
  { value: "window", label: "Window Wall", icon: "🪟" },
  { value: "portable", label: "Portable", icon: "🔌" },
  { value: "cassette", label: "Cassette", icon: "⬛" },
  { value: "under-ceiling", label: "Under-Ceiling", icon: "📐" },
  { value: "ducted", label: "Ducted (Hideaway)", icon: "🔧" },
  { value: "floor", label: "Floor Standing", icon: "🗄️" },
];

const capacities = [
  { btu: 9000, kw: 2.6 },
  { btu: 12000, kw: 3.5 },
  { btu: 18000, kw: 5.3 },
  { btu: 24000, kw: 7.0 },
  { btu: 36000, kw: 10.5 },
  { btu: 48000, kw: 14.0 },
  { btu: 60000, kw: 17.6 },
];

const formatZAR = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

const GuidedProductSelector = ({ open, onOpenChange, onAddItem }: GuidedProductSelectorProps) => {
  const [step, setStep] = useState(1);
  const [selectedUnitType, setSelectedUnitType] = useState<string | null>(null);
  const [selectedCapacity, setSelectedCapacity] = useState<number | null>(null);
  const [selectedInverter, setSelectedInverter] = useState<boolean | null>(null);
  const [selectedRange, setSelectedRange] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [selectedProduct, setSelectedProduct] = useState<CatalogProduct | null>(null);

  const { data: allProducts = [], isLoading } = useQuery({
    queryKey: ["catalog-products-guided"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("supplier_products" as any)
        .select("id, product_code, description, category, selling_price, cost_price, btu_rating, unit_type, capacity_btu, inverter, model_range, is_price_on_request")
        .eq("is_active", true)
        .order("description");
      if (error) throw error;
      return (data || []) as unknown as CatalogProduct[];
    },
    enabled: open,
  });

  const fuse = useMemo(() => new Fuse(allProducts, {
    keys: ["product_code", "description", "category", "model_range"],
    threshold: 0.4,
  }), [allProducts]);

  const fuzzyResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return fuse.search(searchQuery).map(r => r.item);
  }, [fuse, searchQuery]);

  // Derive available options based on selections
  const filteredByUnit = useMemo(() => {
    if (!selectedUnitType) return allProducts;
    return allProducts.filter(p => {
      if (p.unit_type) return p.unit_type.toLowerCase() === selectedUnitType;
      // Fallback: fuzzy match on description/category
      const desc = (p.description + " " + p.category).toLowerCase();
      return desc.includes(selectedUnitType) ||
        (selectedUnitType === "midwall" && (desc.includes("split") || desc.includes("hi-wall") || desc.includes("hiwall") || desc.includes("mid-wall"))) ||
        (selectedUnitType === "ducted" && (desc.includes("ducted") || desc.includes("hideaway"))) ||
        (selectedUnitType === "floor" && desc.includes("floor")) ||
        (selectedUnitType === "cassette" && desc.includes("cassette")) ||
        (selectedUnitType === "under-ceiling" && (desc.includes("under-ceiling") || desc.includes("under ceiling"))) ||
        (selectedUnitType === "window" && desc.includes("window")) ||
        (selectedUnitType === "portable" && desc.includes("portable"));
    });
  }, [allProducts, selectedUnitType]);

  const availableCapacities = useMemo(() => {
    const btus = new Set<number>();
    filteredByUnit.forEach(p => {
      const btu = p.capacity_btu || p.btu_rating;
      if (btu) btus.add(btu);
    });
    return capacities.filter(c => btus.has(c.btu));
  }, [filteredByUnit]);

  const filteredByCapacity = useMemo(() => {
    if (!selectedCapacity) return filteredByUnit;
    return filteredByUnit.filter(p => {
      const btu = p.capacity_btu || p.btu_rating;
      return btu === selectedCapacity;
    });
  }, [filteredByUnit, selectedCapacity]);

  const filteredByInverter = useMemo(() => {
    if (selectedInverter === null) return filteredByCapacity;
    return filteredByCapacity.filter(p => {
      if (p.inverter !== null) return p.inverter === selectedInverter;
      const desc = p.description.toLowerCase();
      if (selectedInverter) return desc.includes("inverter") && !desc.includes("non-inverter") && !desc.includes("fixed");
      return desc.includes("fixed") || desc.includes("non-inverter") || !desc.includes("inverter");
    });
  }, [filteredByCapacity, selectedInverter]);

  const availableRanges = useMemo(() => {
    const ranges = new Set<string>();
    filteredByInverter.forEach(p => {
      if (p.model_range) ranges.add(p.model_range);
      else {
        const desc = p.description.toLowerCase();
        if (desc.includes("breezeless")) ranges.add("Breezeless");
        else if (desc.includes("xtreme")) ranges.add("Xtreme");
        else if (desc.includes("aurora")) ranges.add("Aurora");
        else ranges.add("Standard");
      }
    });
    return Array.from(ranges);
  }, [filteredByInverter]);

  const finalProducts = useMemo(() => {
    if (!selectedRange) return filteredByInverter;
    return filteredByInverter.filter(p => {
      if (p.model_range) return p.model_range === selectedRange;
      return p.description.toLowerCase().includes(selectedRange.toLowerCase());
    });
  }, [filteredByInverter, selectedRange]);

  const reset = () => {
    setStep(1);
    setSelectedUnitType(null);
    setSelectedCapacity(null);
    setSelectedInverter(null);
    setSelectedRange(null);
    setSearchQuery("");
    setQuantity(1);
    setSelectedProduct(null);
  };

  const handleClose = () => {
    onOpenChange(false);
    reset();
  };

  const handleAddProduct = (product: CatalogProduct) => {
    onAddItem({
      description: `${product.product_code} - ${product.description}`,
      quantity,
      rate: product.selling_price,
      amount: quantity * product.selling_price,
    });
    handleClose();
  };

  const handleAddCustom = () => {
    onAddItem({ description: searchQuery || "Custom Item", quantity: 1, rate: 0, amount: 0 });
    handleClose();
  };

  const goBack = () => {
    if (step > 1) {
      if (step === 2) setSelectedUnitType(null);
      if (step === 3) setSelectedCapacity(null);
      if (step === 4) setSelectedInverter(null);
      if (step === 5) { setSelectedRange(null); setSelectedProduct(null); }
      setStep(step - 1);
    }
  };

  const stepLabels = ["Unit Type", "Capacity", "Inverter", "Model Range", "Confirm"];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Add Product from Catalog
          </DialogTitle>
          <DialogDescription>Step {step} of 5 — {stepLabels[step - 1]}</DialogDescription>
        </DialogHeader>

        {/* Progress dots */}
        <div className="flex items-center gap-1.5 mb-2">
          {[1, 2, 3, 4, 5].map(s => (
            <div key={s} className={`h-1.5 flex-1 rounded-full transition-colors ${s <= step ? "bg-primary" : "bg-muted"}`} />
          ))}
        </div>

        {/* Fuzzy search always visible */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Quick search by model name or code..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Fuzzy search results overlay */}
        {searchQuery.trim() && fuzzyResults.length > 0 && (
          <div className="space-y-1.5 mb-3 max-h-48 overflow-y-auto border rounded-lg p-2 bg-accent/20">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider px-1">Search Results</p>
            {fuzzyResults.slice(0, 6).map(p => (
              <button
                key={p.id}
                onClick={() => { setSelectedProduct(p); setStep(5); setSearchQuery(""); }}
                className="w-full text-left p-2 rounded-md hover:bg-accent transition-colors"
              >
                <p className="text-xs font-mono text-primary">{p.product_code}</p>
                <p className="text-sm font-medium line-clamp-1">{p.description}</p>
                <p className="text-xs text-muted-foreground">{!p.is_price_on_request ? formatZAR(p.selling_price) : "Price on request"}</p>
              </button>
            ))}
          </div>
        )}

        {searchQuery.trim() && fuzzyResults.length === 0 && (
          <div className="text-center py-3 mb-3 border rounded-lg bg-accent/10">
            <p className="text-sm text-muted-foreground mb-2">No matching products found</p>
            <Button variant="outline" size="sm" onClick={handleAddCustom}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add as Custom Item
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {/* Step 1: Unit Type */}
            {step === 1 && (
              <div className="grid grid-cols-2 gap-2">
                {unitTypes.map(ut => (
                  <button
                    key={ut.value}
                    onClick={() => { setSelectedUnitType(ut.value); setStep(2); }}
                    className="p-4 rounded-xl border hover:border-primary hover:bg-primary/5 transition-all text-center"
                  >
                    <span className="text-2xl block mb-1">{ut.icon}</span>
                    <p className="text-sm font-medium">{ut.label}</p>
                  </button>
                ))}
              </div>
            )}

            {/* Step 2: Capacity */}
            {step === 2 && (
              <div className="space-y-2">
                {step > 1 && (
                  <Button variant="ghost" size="sm" onClick={goBack} className="mb-1">
                    <ArrowLeft className="h-4 w-4 mr-1" /> Back
                  </Button>
                )}
                {availableCapacities.length === 0 ? (
                  <div className="text-center py-6">
                    <p className="text-sm text-muted-foreground mb-2">No specific capacities found for this unit type.</p>
                    <Button variant="outline" size="sm" onClick={() => { setSelectedCapacity(null); setStep(3); }}>
                      <ArrowRight className="h-4 w-4 mr-1" /> Skip to next step
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {availableCapacities.map(c => (
                      <button
                        key={c.btu}
                        onClick={() => { setSelectedCapacity(c.btu); setStep(3); }}
                        className="p-3 rounded-xl border hover:border-primary hover:bg-primary/5 transition-all text-center"
                      >
                        <p className="text-lg font-bold text-primary">{(c.btu / 1000).toFixed(0)}K</p>
                        <p className="text-xs text-muted-foreground">{c.btu.toLocaleString()} BTU ({c.kw}kW)</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Step 3: Inverter */}
            {step === 3 && (
              <div className="space-y-2">
                <Button variant="ghost" size="sm" onClick={goBack} className="mb-1">
                  <ArrowLeft className="h-4 w-4 mr-1" /> Back
                </Button>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => { setSelectedInverter(true); setStep(4); }}
                    className="p-5 rounded-xl border hover:border-primary hover:bg-primary/5 transition-all text-center"
                  >
                    <Zap className="h-8 w-8 mx-auto mb-2 text-green-500" />
                    <p className="font-semibold">Inverter</p>
                    <p className="text-xs text-muted-foreground mt-1">Energy efficient, variable speed</p>
                  </button>
                  <button
                    onClick={() => { setSelectedInverter(false); setStep(4); }}
                    className="p-5 rounded-xl border hover:border-primary hover:bg-primary/5 transition-all text-center"
                  >
                    <ZapOff className="h-8 w-8 mx-auto mb-2 text-orange-500" />
                    <p className="font-semibold">Non-Inverter</p>
                    <p className="text-xs text-muted-foreground mt-1">Fixed speed, budget-friendly</p>
                  </button>
                </div>
              </div>
            )}

            {/* Step 4: Model Range */}
            {step === 4 && (
              <div className="space-y-2">
                <Button variant="ghost" size="sm" onClick={goBack} className="mb-1">
                  <ArrowLeft className="h-4 w-4 mr-1" /> Back
                </Button>
                {availableRanges.length === 0 ? (
                  <div className="text-center py-6">
                    <p className="text-sm text-muted-foreground mb-2">No specific ranges found. Showing all matching products.</p>
                    <Button variant="outline" size="sm" onClick={() => { setSelectedRange(null); setStep(5); }}>
                      <ArrowRight className="h-4 w-4 mr-1" /> View Products
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {availableRanges.map(r => (
                      <button
                        key={r}
                        onClick={() => { setSelectedRange(r); setStep(5); }}
                        className="w-full p-3 rounded-xl border hover:border-primary hover:bg-primary/5 transition-all text-left flex items-center gap-3"
                      >
                        <Wind className="h-5 w-5 text-primary shrink-0" />
                        <div>
                          <p className="font-semibold text-sm">{r}</p>
                          <p className="text-xs text-muted-foreground">
                            {filteredByInverter.filter(p => p.model_range === r || p.description.toLowerCase().includes(r.toLowerCase())).length} products
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Step 5: Confirm & Add */}
            {step === 5 && (
              <div className="space-y-3">
                <Button variant="ghost" size="sm" onClick={goBack} className="mb-1">
                  <ArrowLeft className="h-4 w-4 mr-1" /> Back
                </Button>

                {/* Selection summary */}
                <div className="flex flex-wrap gap-1.5">
                  {selectedUnitType && <Badge variant="secondary" className="text-[10px]">{unitTypes.find(u => u.value === selectedUnitType)?.label}</Badge>}
                  {selectedCapacity && <Badge variant="secondary" className="text-[10px]">{(selectedCapacity / 1000).toFixed(0)}K BTU</Badge>}
                  {selectedInverter !== null && <Badge variant="secondary" className="text-[10px]">{selectedInverter ? "Inverter" : "Non-Inverter"}</Badge>}
                  {selectedRange && <Badge variant="secondary" className="text-[10px]">{selectedRange}</Badge>}
                </div>

                {selectedProduct ? (
                  <Card className="border-primary">
                    <CardContent className="p-4 space-y-3">
                      <div>
                        <p className="text-xs font-mono text-primary">{selectedProduct.product_code}</p>
                        <p className="font-medium text-sm">{selectedProduct.description}</p>
                        <p className="text-lg font-bold text-primary mt-1">{formatZAR(selectedProduct.selling_price)}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Label className="text-xs text-muted-foreground">Qty:</Label>
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setQuantity(Math.max(1, quantity - 1))}>
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="font-bold text-lg w-8 text-center">{quantity}</span>
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setQuantity(quantity + 1)}>
                          <Plus className="h-3 w-3" />
                        </Button>
                        <span className="text-sm text-muted-foreground ml-auto">
                          = {formatZAR(quantity * selectedProduct.selling_price)}
                        </span>
                      </div>
                      <Button className="w-full" onClick={() => handleAddProduct(selectedProduct)}>
                        <Check className="h-4 w-4 mr-1" /> Add to Invoice
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {finalProducts.length === 0 ? (
                      <div className="text-center py-6">
                        <Package className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-40" />
                        <p className="text-sm text-muted-foreground mb-2">No matching products found</p>
                        <Button variant="outline" size="sm" onClick={handleAddCustom}>
                          <Plus className="h-3.5 w-3.5 mr-1" /> Add Custom Item
                        </Button>
                      </div>
                    ) : (
                      finalProducts.map(p => (
                        <button
                          key={p.id}
                          onClick={() => setSelectedProduct(p)}
                          className="w-full text-left p-3 rounded-lg border hover:border-primary hover:bg-primary/5 transition-all"
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-mono text-primary">{p.product_code}</p>
                              <p className="text-sm font-medium line-clamp-2">{p.description}</p>
                            </div>
                            <p className="font-bold text-sm shrink-0 ml-2">
                              {p.is_price_on_request ? "POR" : formatZAR(p.selling_price)}
                            </p>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default GuidedProductSelector;
