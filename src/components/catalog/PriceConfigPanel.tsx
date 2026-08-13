import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Settings2, ArrowRight, Check } from "lucide-react";

const formatZAR = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

export interface PriceConfig {
  selectedPriceColumn: string;
  priceIncludesVat: boolean;
  priceIncludesMarkup: boolean;
  supplierMarkupPercent: number;
  supplierDiscountPercent: number;
  yourMarkupPercent: number;
  vatRate: number;
}

interface PriceConfigPanelProps {
  detectedPriceColumns: string[];
  samplePrices: Record<string, number>; // first product's prices for preview
  savedConfig?: Partial<PriceConfig>;
  onConfirm: (config: PriceConfig) => void;
  onBack: () => void;
}

function calculatePrices(rawPrice: number, config: PriceConfig) {
  let price = rawPrice;
  // Step 1: Remove VAT if included in the PDF price
  if (config.priceIncludesVat) {
    price = price / (1 + config.vatRate / 100);
  }
  // Step 2: Remove supplier markup if included
  if (config.priceIncludesMarkup && config.supplierMarkupPercent > 0) {
    price = price / (1 + config.supplierMarkupPercent / 100);
  }
  // This is the BASE list price excl VAT, before the supplier trade discount.
  const listPriceExclVat = price;

  // Preview values (for the live preview panel only)
  const discountedCost = listPriceExclVat * (1 - config.supplierDiscountPercent / 100);
  const costInclVat = discountedCost * (1 + config.vatRate / 100);
  const sellingPrice = discountedCost * (1 + config.yourMarkupPercent / 100);

  return {
    trueCost: discountedCost,        // preview only
    costExclVat: listPriceExclVat,   // STORED in DB — raw, undiscounted
    costInclVat,                      // preview only
    sellingPrice,                     // preview only
  };
}

export { calculatePrices };

const PriceConfigPanel = ({ detectedPriceColumns, samplePrices, savedConfig, onConfirm, onBack }: PriceConfigPanelProps) => {
  const [config, setConfig] = useState<PriceConfig>({
    selectedPriceColumn: savedConfig?.selectedPriceColumn || detectedPriceColumns[0] || "Unit Price",
    priceIncludesVat: savedConfig?.priceIncludesVat ?? false,
    priceIncludesMarkup: savedConfig?.priceIncludesMarkup ?? false,
    supplierMarkupPercent: savedConfig?.supplierMarkupPercent ?? 0,
    supplierDiscountPercent: savedConfig?.supplierDiscountPercent ?? 0,
    yourMarkupPercent: savedConfig?.yourMarkupPercent ?? 30,
    vatRate: savedConfig?.vatRate ?? 15,
  });

  const selectedPrice = samplePrices[config.selectedPriceColumn] || 0;
  const preview = useMemo(() => calculatePrices(selectedPrice, config), [selectedPrice, config]);

  const update = (partial: Partial<PriceConfig>) => setConfig(prev => ({ ...prev, ...partial }));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Settings2 className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Price Configuration</h3>
      </div>

      {/* Detected price columns */}
      <div>
        <Label className="text-xs font-medium mb-2 block">
          Detected price columns ({detectedPriceColumns.length})
        </Label>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {detectedPriceColumns.map(col => (
            <Badge key={col} variant={col === config.selectedPriceColumn ? "default" : "outline"} className="text-xs">
              {col}
            </Badge>
          ))}
        </div>

        <Label className="text-xs font-medium mb-2 block">Select base price column</Label>
        <RadioGroup
          value={config.selectedPriceColumn}
          onValueChange={(v) => update({ selectedPriceColumn: v })}
          className="space-y-1.5"
        >
          {detectedPriceColumns.map(col => (
            <div key={col} className="flex items-center gap-2 rounded-md border border-border p-2">
              <RadioGroupItem value={col} id={`price-col-${col}`} />
              <Label htmlFor={`price-col-${col}`} className="text-xs flex-1 cursor-pointer">
                {col}
              </Label>
              <span className="text-xs font-mono text-muted-foreground">
                {samplePrices[col] ? formatZAR(samplePrices[col]) : "—"}
              </span>
            </div>
          ))}
        </RadioGroup>
      </div>

      <Separator />

      {/* Price adjustments */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex items-center justify-between gap-2 rounded-md border border-border p-2">
          <Label className="text-xs">Price includes VAT?</Label>
          <Switch checked={config.priceIncludesVat} onCheckedChange={(v) => update({ priceIncludesVat: v })} />
        </div>

        <div className="flex items-center justify-between gap-2 rounded-md border border-border p-2">
          <Label className="text-xs">Price includes supplier markup?</Label>
          <Switch checked={config.priceIncludesMarkup} onCheckedChange={(v) => update({ priceIncludesMarkup: v })} />
        </div>

        {config.priceIncludesMarkup && (
          <div className="flex items-center gap-2">
            <Label className="text-xs whitespace-nowrap">Supplier Markup %</Label>
            <Input type="number" value={config.supplierMarkupPercent}
              onChange={(e) => update({ supplierMarkupPercent: Number(e.target.value) || 0 })}
              className="w-20 h-8 text-sm" min={0} max={500} />
          </div>
        )}

        <div className="flex items-center gap-2">
          <Label className="text-xs whitespace-nowrap">Supplier Discount %</Label>
          <Input type="number" value={config.supplierDiscountPercent}
            onChange={(e) => update({ supplierDiscountPercent: Number(e.target.value) || 0 })}
            className="w-20 h-8 text-sm" min={0} max={100} />
        </div>

        <div className="flex items-center gap-2">
          <Label className="text-xs whitespace-nowrap">VAT Rate %</Label>
          <Input type="number" value={config.vatRate}
            onChange={(e) => update({ vatRate: Number(e.target.value) || 0 })}
            className="w-20 h-8 text-sm" min={0} max={50} />
        </div>

        <div className="flex items-center gap-2">
          <Label className="text-xs whitespace-nowrap font-semibold">Your Markup %</Label>
          <Input type="number" value={config.yourMarkupPercent}
            onChange={(e) => update({ yourMarkupPercent: Number(e.target.value) || 0 })}
            className="w-20 h-8 text-sm" min={0} max={500} />
        </div>
      </div>

      <Separator />

      {/* Live preview calculation */}
      {selectedPrice > 0 && (
        <div className="rounded-lg bg-muted/50 p-3 space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground">Live Price Preview (first product)</p>
          <div className="flex items-center gap-1 text-xs flex-wrap">
            <span className="font-mono">{formatZAR(selectedPrice)}</span>
            <span className="text-muted-foreground">({config.selectedPriceColumn})</span>
          </div>
          {config.supplierDiscountPercent > 0 && (
            <div className="flex items-center gap-1 text-xs">
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <span>minus {config.supplierDiscountPercent}% discount</span>
              <span className="font-mono">{formatZAR(selectedPrice * (1 - config.supplierDiscountPercent / 100))}</span>
            </div>
          )}
          {config.priceIncludesVat && (
            <div className="flex items-center gap-1 text-xs">
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <span>minus {config.vatRate}% VAT</span>
            </div>
          )}
          {config.priceIncludesMarkup && config.supplierMarkupPercent > 0 && (
            <div className="flex items-center gap-1 text-xs">
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <span>minus {config.supplierMarkupPercent}% supplier markup</span>
            </div>
          )}
          <div className="flex items-center gap-1 text-xs font-semibold pt-1">
            <span>=</span>
            <span className="text-primary font-mono">{formatZAR(preview.trueCost)}</span>
            <span className="text-muted-foreground">(true cost)</span>
          </div>
          <div className="flex items-center gap-1 text-xs font-semibold">
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <span>plus {config.yourMarkupPercent}% markup =</span>
            <span className="text-primary font-mono font-bold">{formatZAR(preview.sellingPrice)}</span>
            <span className="text-muted-foreground">(selling price)</span>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={onBack}>Back</Button>
        <Button size="sm" onClick={() => onConfirm(config)}>
          <Check className="h-3 w-3 mr-1" /> Continue to Diff Preview
        </Button>
      </div>
    </div>
  );
};

export default PriceConfigPanel;
