import { useState, useMemo } from "react";
import { Search, Plus, Minus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import type { PaletteProduct } from "../../QuoteBuilderTab";
import type { QuoteArea, AreaACUnit } from "../quoteWizardTypes";
import { detectBTU, getBracketSize } from "../quoteWizardTypes";

interface Props {
  areas: QuoteArea[];
  onAreasChange: (areas: QuoteArea[]) => void;
  products: PaletteProduct[];
}

export default function ACSelectionStep({ areas, onAreasChange, products }: Props) {
  const [searchQuery, setSearchQuery] = useState("");

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

      <Accordion type="multiple" defaultValue={areas.map((a) => a.id)} className="space-y-2">
        {areas.map((area) => (
          <AccordionItem key={area.id} value={area.id} className="border rounded-lg bg-card">
            <AccordionTrigger className="px-3 py-2 text-sm font-medium hover:no-underline">
              <div className="flex items-center gap-2">
                {area.name}
                <Badge variant="secondary" className="text-xs">
                  {area.acUnits.length} unit{area.acUnits.length !== 1 ? "s" : ""}
                </Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-3 pb-3 space-y-3">
              {/* Selected units */}
              {area.acUnits.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Selected:</span>
                  {area.acUnits.map((unit) => (
                    <div key={unit.id} className="flex items-center gap-2 rounded border bg-muted/50 px-2 py-1.5 text-xs">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{unit.product.short_name || unit.product.product_code}</div>
                        <div className="text-muted-foreground flex gap-2">
                          <span>{unit.product.brand}</span>
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
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{p.short_name || p.product_code}</div>
                          <div className="text-muted-foreground">{p.brand} · {btu.toLocaleString()} BTU</div>
                        </div>
                        <span className="font-medium shrink-0">
                          R {(p.selling_price || p.cost_incl_vat || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                        </span>
                        <Plus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      </button>
                    );
                  })
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
