import { useState, useMemo, useCallback } from "react";
import { RotateCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { QuoteArea } from "../quoteWizardTypes";

interface Props {
  areas: QuoteArea[];
  onAreasChange: (areas: QuoteArea[]) => void;
}

const VAT_RATE = 0.15;

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(value);
}

interface AreaPricing {
  areaId: string;
  quantity: number;
  markupPercent: number;
}

export default function PricingStep({ areas, onAreasChange }: Props) {
  const [globalMarkup, setGlobalMarkup] = useState(30);
  const [areaPricing, setAreaPricing] = useState<Record<string, AreaPricing>>(() => {
    const init: Record<string, AreaPricing> = {};
    for (const a of areas) {
      init[a.id] = { areaId: a.id, quantity: a.acUnits[0]?.quantity || 1, markupPercent: 30 };
    }
    return init;
  });

  const getPricing = (areaId: string) =>
    areaPricing[areaId] || { areaId, quantity: 1, markupPercent: globalMarkup };

  const updateAreaPricing = useCallback((areaId: string, patch: Partial<AreaPricing>) => {
    setAreaPricing((prev) => ({
      ...prev,
      [areaId]: { ...prev[areaId], areaId, quantity: prev[areaId]?.quantity || 1, markupPercent: prev[areaId]?.markupPercent ?? globalMarkup, ...patch },
    }));
  }, [globalMarkup]);

  const resetAllToGlobal = useCallback(() => {
    setAreaPricing((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        next[key] = { ...next[key], markupPercent: globalMarkup };
      }
      return next;
    });
  }, [globalMarkup]);

  const allHaveUnits = areas.every((a) => a.acUnits.length > 0);

  // Compute totals
  const lineItems = useMemo(() => {
    return areas.map((area) => {
      const unit = area.acUnits[0];
      if (!unit) return { area, costPrice: 0, quantity: 1, markup: 0, sellingPrice: 0, lineTotal: 0 };
      const pricing = getPricing(area.id);
      const costPrice = unit.product.cost_excl_vat || unit.product.cost_incl_vat || 0;
      const sellingPrice = costPrice * (1 + pricing.markupPercent / 100);
      const lineTotal = sellingPrice * pricing.quantity;
      return { area, costPrice, quantity: pricing.quantity, markup: pricing.markupPercent, sellingPrice, lineTotal };
    });
  }, [areas, areaPricing, globalMarkup]);

  const subtotal = lineItems.reduce((s, l) => s + l.lineTotal, 0);
  const vatAmount = subtotal * VAT_RATE;
  const total = subtotal + vatAmount;

  return (
    <div className="space-y-4">
      {/* Global markup */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            Global Markup
            <Button variant="ghost" size="sm" className="text-xs gap-1 h-7" onClick={resetAllToGlobal}>
              <RotateCcw className="h-3 w-3" /> Reset All
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-3">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground whitespace-nowrap">Default Markup %</Label>
            <Input
              type="number"
              value={globalMarkup}
              onChange={(e) => setGlobalMarkup(parseFloat(e.target.value) || 0)}
              className="h-8 w-24 text-sm"
              min={0}
              step={5}
            />
          </div>
        </CardContent>
      </Card>

      {/* Per-area pricing */}
      <div className="space-y-2">
        {lineItems.map(({ area, costPrice, quantity, markup, sellingPrice, lineTotal }) => {
          const unit = area.acUnits[0];
          const pricing = getPricing(area.id);

          return (
            <Card key={area.id}>
              <CardContent className="py-3 px-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{area.name}</span>
                  {unit ? (
                    <Badge variant="outline" className="text-[10px]">
                      {unit.product.product_code} · {unit.btu.toLocaleString()} BTU
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="text-[10px]">No unit selected</Badge>
                  )}
                </div>

                {unit && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Qty</Label>
                      <Input
                        type="number"
                        value={pricing.quantity}
                        onChange={(e) => updateAreaPricing(area.id, { quantity: Math.max(1, parseInt(e.target.value) || 1) })}
                        className="h-7 text-xs"
                        min={1}
                      />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Cost Price</Label>
                      <div className="h-7 flex items-center text-xs text-muted-foreground">
                        {formatCurrency(costPrice)}
                      </div>
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Markup %</Label>
                      <Input
                        type="number"
                        value={pricing.markupPercent}
                        onChange={(e) => updateAreaPricing(area.id, { markupPercent: parseFloat(e.target.value) || 0 })}
                        className="h-7 text-xs"
                        min={0}
                        step={5}
                      />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Selling Price</Label>
                      <div className="h-7 flex items-center text-xs font-medium">
                        {formatCurrency(sellingPrice)}
                      </div>
                    </div>
                  </div>
                )}

                {unit && (
                  <div className="flex justify-end text-xs">
                    <span className="text-muted-foreground mr-2">Line Total:</span>
                    <span className="font-semibold">{formatCurrency(lineTotal)}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Summary */}
      <Card>
        <CardContent className="py-3 px-4 space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Subtotal (excl. VAT)</span>
            <span className="font-medium">{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">VAT (15%)</span>
            <span>{formatCurrency(vatAmount)}</span>
          </div>
          <Separator />
          <div className="flex justify-between text-sm font-bold">
            <span>Total Incl. VAT</span>
            <span>{formatCurrency(total)}</span>
          </div>
        </CardContent>
      </Card>

      {!allHaveUnits && (
        <p className="text-xs text-destructive text-center">
          Some areas have no AC unit selected. Go back to Step 2 to assign units.
        </p>
      )}
    </div>
  );
}
