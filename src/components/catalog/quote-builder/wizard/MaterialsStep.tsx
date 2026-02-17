import { useEffect, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Minus } from "lucide-react";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import type { PaletteProduct } from "../../QuoteBuilderTab";
import type { QuoteArea, AreaMaterial, AreaBracket } from "../quoteWizardTypes";
import { getBracketSize } from "../quoteWizardTypes";

interface BundleItem {
  id: string;
  supplier_product_id: string;
  quantity: number;
  length_metres: number | null;
  is_length_item: boolean;
  is_optional: boolean;
  product: PaletteProduct | null;
}

interface Bundle {
  id: string;
  name: string;
  description: string | null;
  bundle_type: string | null;
  items: BundleItem[];
}

interface Props {
  areas: QuoteArea[];
  onAreasChange: (areas: QuoteArea[]) => void;
  bundles: Bundle[];
  products: PaletteProduct[];
}

const BRACKET_PRICES: Record<string, number> = {
  "450mm": 350,
  "650mm": 450,
  "L-shape": 650,
};

export default function MaterialsStep({ areas, onAreasChange, bundles, products }: Props) {
  // Auto-populate materials from bundles on mount if empty
  useEffect(() => {
    const needsPopulation = areas.some((a) => a.acUnits.length > 0 && a.materials.length === 0 && a.brackets.length === 0);
    if (!needsPopulation) return;

    // Find a piping/materials bundle
    const materialBundle = bundles.find((b) =>
      b.bundle_type === "piping" || b.name.toLowerCase().includes("piping") || b.name.toLowerCase().includes("material")
    ) || bundles[0];

    onAreasChange(
      areas.map((area) => {
        if (area.acUnits.length === 0 || area.materials.length > 0) return area;

        // Generate materials from bundle
        const materials: AreaMaterial[] = [];
        if (materialBundle) {
          for (const item of materialBundle.items) {
            if (!item.product || item.is_optional) continue;
            if (item.is_length_item && item.product.price_per_metre) {
              materials.push({
                id: crypto.randomUUID(),
                product: item.product,
                defaultLength: item.length_metres || item.product.unit_length || 3,
                adjustedLength: item.length_metres || item.product.unit_length || 3,
                costPerMeter: item.product.price_per_metre,
                totalCost: (item.length_metres || item.product.unit_length || 3) * item.product.price_per_metre,
              });
            }
          }
        }

        // Generate brackets from AC units
        const brackets: AreaBracket[] = [];
        for (const unit of area.acUnits) {
          const size = getBracketSize(unit.btu);
          const existing = brackets.find((b) => b.size === size);
          if (existing) {
            existing.quantity += unit.quantity;
          } else {
            brackets.push({
              id: crypto.randomUUID(),
              size,
              quantity: unit.quantity,
              price: BRACKET_PRICES[size] || 350,
            });
          }
        }

        return { ...area, materials, brackets };
      })
    );
  }, [areas, bundles, onAreasChange]);

  const updateMaterialLength = (areaId: string, matId: string, length: number) => {
    onAreasChange(
      areas.map((a) => {
        if (a.id !== areaId) return a;
        return {
          ...a,
          materials: a.materials.map((m) =>
            m.id === matId
              ? { ...m, adjustedLength: length, totalCost: length * m.costPerMeter }
              : m
          ),
        };
      })
    );
  };

  const updateBracketQty = (areaId: string, bracketId: string, delta: number) => {
    onAreasChange(
      areas.map((a) => {
        if (a.id !== areaId) return a;
        return {
          ...a,
          brackets: a.brackets.map((b) =>
            b.id === bracketId ? { ...b, quantity: Math.max(1, b.quantity + delta) } : b
          ),
        };
      })
    );
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Materials are auto-populated from installation bundles. Adjust pipe lengths and bracket quantities per area.
      </p>

      <Accordion type="multiple" defaultValue={areas.map((a) => a.id)} className="space-y-2">
        {areas.map((area) => {
          const matTotal = area.materials.reduce((s, m) => s + m.totalCost, 0);
          const bracketTotal = area.brackets.reduce((s, b) => s + b.price * b.quantity, 0);
          return (
            <AccordionItem key={area.id} value={area.id} className="border rounded-lg bg-card">
              <AccordionTrigger className="px-3 py-2 text-sm font-medium hover:no-underline">
                <div className="flex items-center gap-2">
                  {area.name}
                  <Badge variant="secondary" className="text-xs">
                    R {(matTotal + bracketTotal).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                  </Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3 space-y-4">
                {area.acUnits.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">Add AC units in Step 2 first</p>
                ) : (
                  <>
                    {/* Materials */}
                    {area.materials.length > 0 && (
                      <div className="space-y-3">
                        <Label className="text-xs font-medium">Piping & Materials</Label>
                        {area.materials.map((mat) => (
                          <div key={mat.id} className="space-y-1.5 rounded border bg-muted/30 p-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-medium truncate">{mat.product.short_name || mat.product.product_code}</span>
                              <span className="text-muted-foreground">R {mat.costPerMeter.toFixed(2)}/m</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <Input
                                type="number"
                                min={0.5}
                                max={50}
                                step={0.5}
                                value={mat.adjustedLength}
                                onChange={(e) => updateMaterialLength(area.id, mat.id, parseFloat(e.target.value) || 0.5)}
                                className="h-7 w-20 text-xs"
                              />
                              <span className="text-xs text-muted-foreground">m</span>
                              <Slider
                                value={[mat.adjustedLength]}
                                onValueChange={([v]) => updateMaterialLength(area.id, mat.id, v)}
                                min={0.5}
                                max={50}
                                step={0.5}
                                className="flex-1"
                              />
                              <span className="text-xs font-medium w-20 text-right">
                                R {mat.totalCost.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Brackets */}
                    {area.brackets.length > 0 && (
                      <div className="space-y-2">
                        <Label className="text-xs font-medium">Brackets (auto-selected by BTU)</Label>
                        {area.brackets.map((bracket) => (
                          <div key={bracket.id} className="flex items-center gap-2 rounded border bg-muted/30 px-2 py-1.5 text-xs">
                            <Badge variant="outline" className="text-[10px]">{bracket.size}</Badge>
                            <span className="flex-1">@ R {bracket.price.toFixed(2)} each</span>
                            <div className="flex items-center gap-1">
                              <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => updateBracketQty(area.id, bracket.id, -1)}>
                                <Minus className="h-3 w-3" />
                              </Button>
                              <span className="w-6 text-center font-medium">{bracket.quantity}</span>
                              <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => updateBracketQty(area.id, bracket.id, 1)}>
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                            <span className="font-medium w-20 text-right">
                              R {(bracket.price * bracket.quantity).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {area.materials.length === 0 && area.brackets.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-2">
                        No installation bundles found. Materials will need to be added manually.
                      </p>
                    )}

                    {/* Area subtotal */}
                    <div className="flex justify-end pt-2 border-t text-xs">
                      <span className="text-muted-foreground mr-2">Area materials total:</span>
                      <span className="font-bold">
                        R {(matTotal + bracketTotal).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </>
                )}
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
}
