import { useState, useMemo } from "react";
import { Search, Plus, Minus, Star, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import type { PaletteProduct } from "../../QuoteBuilderTab";
import type { QuoteArea, AreaACUnit } from "../quoteWizardTypes";
import { detectBTU, getBracketSize } from "../quoteWizardTypes";

interface Props {
  areas: QuoteArea[];
  onAreasChange: (areas: QuoteArea[]) => void;
  products: PaletteProduct[];
}

function PinnedStar({ pinned }: { pinned: boolean }) {
  return pinned ? (
    <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-500 shrink-0" />
  ) : (
    <Star className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
  );
}

function UnitInfoPopover({ product }: { product: PaletteProduct }) {
  const btu = detectBTU(product);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="h-5 w-5 rounded-full flex items-center justify-center hover:bg-accent shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <Info className="h-3 w-3 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 text-xs space-y-1.5" onClick={(e) => e.stopPropagation()}>
        <p className="font-semibold text-sm">Unit Details</p>
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <span className="text-muted-foreground">Name</span>
          <span className="font-medium">{product.short_name || product.product_code}</span>
          <span className="text-muted-foreground">Model No</span>
          <span>{product.product_code}</span>
          <span className="text-muted-foreground">Brand</span>
          <span>{product.brand}</span>
          <span className="text-muted-foreground">BTU</span>
          <span>{btu.toLocaleString()}</span>
          <span className="text-muted-foreground">Description</span>
          <span className="break-words">{product.description || "—"}</span>
          <span className="text-muted-foreground">Supplier</span>
          <span>{(product as any).supplier_name || "—"}</span>
          <span className="text-muted-foreground">Selling Price</span>
          <span>R {(product.selling_price || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</span>
          <span className="text-muted-foreground">Cost excl VAT</span>
          <span>R {((product as any).cost_excl_vat || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</span>
          <span className="text-muted-foreground">Cost incl VAT</span>
          <span>R {(product.cost_incl_vat || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</span>
          <span className="text-muted-foreground">Pinned</span>
          <span>{(product as any).is_pinned ? "Yes ★" : "No"}</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function areaSummary(area: QuoteArea): string {
  if (area.acUnits.length === 0) return "";
  const first = area.acUnits[0];
  const name = first.product.short_name || first.product.product_code;
  const code = first.product.product_code;
  const btu = first.btu.toLocaleString();
  let summary = `${first.product.brand} ${btu} BTU ${name}`;
  if (code && code !== name) summary += ` (${code})`;
  if (area.acUnits.length > 1) summary += ` +${area.acUnits.length - 1} more`;
  return summary;
}

export default function ACSelectionStep({ areas, onAreasChange, products }: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [openArea, setOpenArea] = useState<string>(areas.length > 0 ? areas[0].id : "");

  const acProducts = useMemo(() => {
    let filtered = products.filter(
      (p) => p.product_category === "Air Conditioning" || (p.category || "").toLowerCase().includes("air conditioning")
    );
    if (searchQuery.trim()) {
      const terms = searchQuery.toLowerCase().split(/\s+/);
      filtered = filtered.filter((p) => {
        const blob = [p.product_code, p.short_name, p.brand, p.description].filter(Boolean).join(" ").toLowerCase();
        return terms.every((t) => blob.includes(t));
      });
    }
    return filtered.slice(0, 50);
  }, [products, searchQuery]);

  const addUnit = (areaId: string, product: PaletteProduct) => {
    const btu = detectBTU(product);
    onAreasChange(
      areas.map((a) => {
        if (a.id !== areaId) return a;
        const existing = a.acUnits.find((u) => u.product.id === product.id);
        if (existing) {
          return { ...a, acUnits: a.acUnits.map((u) => u.product.id === product.id ? { ...u, quantity: u.quantity + 1 } : u) };
        }
        const unit: AreaACUnit = { id: crypto.randomUUID(), product, btu, quantity: 1 };
        return { ...a, acUnits: [...a.acUnits, unit] };
      })
    );
    setOpenArea(""); // collapse after selection
  };

  const updateQty = (areaId: string, unitId: string, delta: number) => {
    onAreasChange(
      areas.map((a) => {
        if (a.id !== areaId) return a;
        return {
          ...a,
          acUnits: a.acUnits
            .map((u) => (u.id === unitId ? { ...u, quantity: Math.max(0, u.quantity + delta) } : u))
            .filter((u) => u.quantity > 0),
        };
      })
    );
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Select AC units for each area. Brackets will be auto-selected based on BTU rating.
      </p>

      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Search AC units..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-8 h-9 text-sm"
        />
      </div>

      <Accordion type="single" collapsible value={openArea} onValueChange={setOpenArea} className="space-y-2">
        {areas.map((area) => (
          <div key={area.id}>
            <AccordionItem value={area.id} className="border rounded-lg bg-card">
              <AccordionTrigger className="px-3 py-2 text-sm font-medium hover:no-underline">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <span>{area.name}</span>
                  {area.acUnits.length > 0 ? (
                    <>
                      <span className="text-muted-foreground text-xs truncate max-w-[280px]">
                        — {areaSummary(area)} ✓
                      </span>
                    </>
                  ) : (
                    <Badge variant="secondary" className="text-xs">
                      0 units
                    </Badge>
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3 space-y-3">
                {/* Selected units */}
                {area.acUnits.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Selected:</span>
                    {area.acUnits.map((unit) => (
                      <div key={unit.id} className="flex items-center gap-2 rounded border bg-muted/50 px-2 py-1.5 text-xs">
                        <div className="h-3 w-3 rounded-full border-2 border-primary bg-primary shrink-0" />
                        <PinnedStar pinned={!!(unit.product as any).is_pinned} />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{unit.product.short_name || unit.product.product_code}</div>
                          <div className="text-muted-foreground flex gap-1 flex-wrap">
                            <span>{unit.product.brand}</span>
                            <span>·</span>
                            <span className="truncate max-w-[140px]">{unit.product.product_code}</span>
                            <span>·</span>
                            <span>{unit.btu.toLocaleString()} BTU</span>
                            <Badge variant="outline" className="text-[10px] px-1 py-0">
                              Bracket: {getBracketSize(unit.btu)}
                            </Badge>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => updateQty(area.id, unit.id, -1)}>
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="w-6 text-center font-medium">{unit.quantity}</span>
                          <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => updateQty(area.id, unit.id, 1)}>
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                        <span className="text-xs font-medium w-20 text-right">
                          R {((unit.product.selling_price || unit.product.cost_incl_vat || 0) * unit.quantity).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Product picker */}
                <div className="max-h-48 overflow-y-auto space-y-1 rounded border p-1.5">
                  {acProducts.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">No AC products found</p>
                  ) : (
                    acProducts.map((p) => {
                      const btu = detectBTU(p);
                      return (
                        <button
                          key={p.id}
                          className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent transition-colors text-left"
                          onClick={() => addUnit(area.id, p)}
                        >
                          <PinnedStar pinned={!!(p as any).is_pinned} />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{p.short_name || p.product_code}</div>
                            <div className="text-muted-foreground truncate">{p.brand} · {p.product_code} · {btu.toLocaleString()} BTU</div>
                          </div>
                          <span className="font-medium shrink-0">
                            R {(p.selling_price || p.cost_incl_vat || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                          </span>
                          <UnitInfoPopover product={p} />
                          <Plus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        </button>
                      );
                    })
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
            {/* Add Unit button when collapsed and has units */}
            {openArea !== area.id && area.acUnits.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 text-xs text-primary"
                onClick={() => setOpenArea(area.id)}
              >
                <Plus className="h-3 w-3 mr-1" /> Add Unit
              </Button>
            )}
          </div>
        ))}
      </Accordion>
    </div>
  );
}
