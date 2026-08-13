import { useState, useMemo, useCallback } from "react";
import { calcSellingPrice, VAT_RATE } from "@/utils/pricing";
import { computeLineTotal, resolvePricingUnit, unitSuffix } from "@/lib/pricingUnits";
import { RotateCcw, FileDown, Loader2, TrendingUp, ChevronDown, ChevronRight, Package, Pencil } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import QuantityControl from "../QuantityControl";
import type { QuoteArea } from "../quoteWizardTypes";

interface Props {
  areas: QuoteArea[];
  onAreasChange: (areas: QuoteArea[]) => void;
  /** Real, persisted "Generate Quote" action (saves to quote_items/quote_areas
   *  with the actual selected client, then opens the send-to-client dialog
   *  using the correct up-to-date PDF template). When omitted, the button is
   *  hidden — this step should never fall back to its own disconnected,
   *  client-side-only quote generation again. */
  onGenerateQuote?: () => void;
  generating?: boolean;
}

// VAT_RATE now imported from @/utils/pricing

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(value);
}

function unitPriceOf(product: any): number {
  return product?.cost_price || product?.cost_excl_vat || product?.price_per_metre || product?.selling_price || 0;
}

function lineTotalOf(product: any, qty: number): number {
  return computeLineTotal(qty, unitPriceOf(product), resolvePricingUnit(product));
}

interface AreaPricing {
  areaId: string;
  quantity: number;
  markupPercent: number;
}

/** Returns a color class based on markup percentage */
function getMarkupColor(markup: number): string {
  if (markup <= 20) return "bg-green-500";
  if (markup <= 35) return "bg-amber-400";
  return "bg-red-500";
}

/* ── Bundle Sub-Items for a single area ── */
function AreaSubItems({ area }: { area: QuoteArea }) {
  const items: { name: string; qty: number; unitPrice: number; lineTotal: number; mode: string }[] = [];

  for (const mat of area.materials) {
    const isLen = mat.pricingMode === "length";
    const unit = resolvePricingUnit(mat.product);
    const unitPrice = unitPriceOf(mat.product);
    const qty = isLen ? mat.adjustedLength : mat.unitQuantity;
    const lineTotal = isLen ? mat.totalCost : lineTotalOf(mat.product, mat.unitQuantity);
    items.push({ name: mat.product.short_name || mat.product.product_code, qty, unitPrice, lineTotal, mode: isLen ? unitSuffix(unit) : unit.price_per_unit_label });
  }
  for (const cons of (area.consumables ?? [])) {
    const unit = resolvePricingUnit(cons.product);
    const price = unitPriceOf(cons.product);
    items.push({ name: cons.product.short_name || cons.product.product_code, qty: cons.quantity, unitPrice: price, lineTotal: lineTotalOf(cons.product, cons.quantity), mode: unit.price_per_unit_label });
  }
  for (const br of area.brackets) {
    items.push({ name: `Bracket ${br.size}`, qty: br.quantity, unitPrice: br.price, lineTotal: br.price * br.quantity, mode: "ea" });
  }

  if (items.length === 0) return <p className="text-[10px] text-muted-foreground pl-6 py-1">No sub-items</p>;

  return (
    <div className="pl-6 pr-4 py-1 space-y-0.5">
      {items.map((item, i) => (
        <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 text-[10px] text-muted-foreground items-center">
          <span className="truncate">{item.name}</span>
          <span className="text-center tabular-nums">{item.qty} {item.mode}</span>
          <span className="text-right tabular-nums">{formatCurrency(item.unitPrice)} / {item.mode}</span>
          <span className="text-right tabular-nums font-medium">{formatCurrency(item.lineTotal)}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Edit Bundle Dialog ── */
function EditBundleDialog({
  area,
  open,
  onOpenChange,
  onSave,
}: {
  area: QuoteArea;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (area: QuoteArea) => void;
}) {
  const [editArea, setEditArea] = useState<QuoteArea>(area);

  // Reset state when dialog opens
  const handleOpenChange = useCallback((o: boolean) => {
    if (o) setEditArea(area);
    onOpenChange(o);
  }, [area, onOpenChange]);

  const updateMaterialQty = (matId: string, qty: number) => {
    setEditArea(prev => ({
      ...prev,
      materials: prev.materials.map(m => m.id === matId
        ? m.pricingMode === "length"
          ? { ...m, adjustedLength: qty, totalCost: qty * m.costPerMeter }
          : { ...m, unitQuantity: qty }
        : m
      ),
    }));
  };

  const updateConsumableQty = (consId: string, qty: number) => {
    setEditArea(prev => ({
      ...prev,
      consumables: prev.consumables.map(c => c.id === consId ? { ...c, quantity: qty } : c),
    }));
  };

  const updateBracketQty = (bracketId: string, qty: number) => {
    setEditArea(prev => ({
      ...prev,
      brackets: prev.brackets.map(b => b.id === bracketId ? { ...b, quantity: qty } : b),
    }));
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">Edit Bundle — {area.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {editArea.materials.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Materials</Label>
              {editArea.materials.map(m => (
                <div key={m.id} className="flex items-center justify-between gap-2">
                  <span className="text-xs truncate flex-1">{m.product.short_name || m.product.product_code}</span>
                  <QuantityControl
                    value={m.pricingMode === "length" ? m.adjustedLength : m.unitQuantity}
                    onChange={(v) => updateMaterialQty(m.id, v)}
                    min={1}
                    max={m.pricingMode === "length" ? 100 : 50}
                    step={m.pricingMode === "length" ? 0.5 : 1}
                    showSlider={false}
                    suffix={m.pricingMode === "length" ? "m" : undefined}
                    size="sm"
                  />
                </div>
              ))}
            </div>
          )}
          {(editArea.consumables?.length ?? 0) > 0 && (
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Consumables</Label>
              {editArea.consumables.map(c => (
                <div key={c.id} className="flex items-center justify-between gap-2">
                  <span className="text-xs truncate flex-1">{c.product.short_name || c.product.product_code}</span>
                  <QuantityControl
                    value={c.quantity}
                    onChange={(v) => updateConsumableQty(c.id, v)}
                    min={1}
                    max={50}
                    showSlider={false}
                    size="sm"
                  />
                </div>
              ))}
            </div>
          )}
          {editArea.brackets.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Brackets</Label>
              {editArea.brackets.map(b => (
                <div key={b.id} className="flex items-center justify-between gap-2">
                  <span className="text-xs truncate flex-1">Bracket {b.size}</span>
                  <QuantityControl
                    value={b.quantity}
                    onChange={(v) => updateBracketQty(b.id, v)}
                    min={1}
                    max={20}
                    showSlider={false}
                    size="sm"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <DialogClose asChild>
            <Button variant="outline" size="sm">Cancel</Button>
          </DialogClose>
          <Button size="sm" onClick={() => { onSave(editArea); onOpenChange(false); }}>
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Read the product's own markup, falling back to 35% */
function getProductMarkup(product: any): number {
  return product?.default_markup_percent ?? 35;
}

export default function PricingStep({ areas, onAreasChange, onGenerateQuote, generating }: Props) {
  // Derive initial global markup from the first AC unit's product markup
  const defaultMarkup = useMemo(() => {
    for (const a of areas) {
      if (a.acUnits[0]?.product) return getProductMarkup(a.acUnits[0].product);
    }
    return 35;
  }, []);

  const [globalMarkup, setGlobalMarkup] = useState(defaultMarkup);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [editingAreaId, setEditingAreaId] = useState<string | null>(null);
  const [areaPricing, setAreaPricing] = useState<Record<string, AreaPricing>>(() => {
    const init: Record<string, AreaPricing> = {};
    for (const a of areas) {
      const productMarkup = a.acUnits[0]?.product ? getProductMarkup(a.acUnits[0].product) : defaultMarkup;
      init[a.id] = { areaId: a.id, quantity: a.acUnits[0]?.quantity || 1, markupPercent: productMarkup };
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

  const toggleRowExpanded = useCallback((areaId: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(areaId)) next.delete(areaId);
      else next.add(areaId);
      return next;
    });
  }, []);

  const handleBundleSave = useCallback((updatedArea: QuoteArea) => {
    onAreasChange(areas.map(a => a.id === updatedArea.id ? updatedArea : a));
  }, [areas, onAreasChange]);

  const allHaveUnits = areas.every((a) => a.acUnits.length > 0);

  const hasSubItems = useCallback((area: QuoteArea) => {
    return area.materials.length > 0 || (area.consumables?.length ?? 0) > 0 || area.brackets.length > 0;
  }, []);

  // Compute totals — include sub-items (materials, consumables, brackets)
  const lineItems = useMemo(() => {
    const getCost = (p: any) => {
      if (p?.cost_price > 0) return p.cost_price;
      if (p?.cost_excl_vat > 0) return p.cost_excl_vat;
      return 0;
    };

    return areas.map((area) => {
      const unit = area.acUnits[0];
      if (!unit) return { area, costPrice: 0, quantity: 1, markup: 0, sellingPrice: 0, lineTotal: 0, subItemsTotal: 0 };
      const pricing = getPricing(area.id);
      const costPrice = getCost(unit.product);
      const { sellingExclVat } = calcSellingPrice(costPrice, pricing.markupPercent);
      const acLineTotal = sellingExclVat * pricing.quantity;

      // Sub-items: materials, consumables, brackets (apply same markup)
      let subItemsCost = 0;
      for (const mat of area.materials) {
        if (mat.pricingMode === "unit") {
          subItemsCost += computeLineTotal(mat.unitQuantity, getCost(mat.product), resolvePricingUnit(mat.product));
        } else {
          const perM = mat.costPerMeter || getCost(mat.product);
          subItemsCost += mat.totalCost || perM * mat.adjustedLength;
        }
      }
      for (const cons of (area.consumables ?? [])) {
        subItemsCost += computeLineTotal(cons.quantity, getCost(cons.product), resolvePricingUnit(cons.product));
      }
      for (const br of area.brackets) {
        subItemsCost += br.price * br.quantity;
      }
      const { sellingExclVat: subSell } = calcSellingPrice(subItemsCost, pricing.markupPercent);
      const lineTotal = acLineTotal + subSell;

      return { area, costPrice, quantity: pricing.quantity, markup: pricing.markupPercent, sellingPrice: sellingExclVat, lineTotal, subItemsTotal: subSell };
    });
  }, [areas, areaPricing, globalMarkup]);

  const subtotal = useMemo(() => lineItems.reduce((s, l) => s + l.lineTotal, 0), [lineItems]);
  const vatAmount = useMemo(() => subtotal * VAT_RATE, [subtotal]);
  const total = useMemo(() => subtotal + vatAmount, [subtotal, vatAmount]);
  const avgMarkup = useMemo(() => {
    const withUnits = lineItems.filter((l) => l.markup > 0);
    return withUnits.length > 0 ? withUnits.reduce((s, l) => s + l.markup, 0) / withUnits.length : 0;
  }, [lineItems]);

  const editingArea = editingAreaId ? areas.find(a => a.id === editingAreaId) : null;

  return (
    <div className="space-y-4 overflow-x-auto">
      {/* Global markup */}
      <Card className="shadow-sm">
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
            <Tooltip>
              <TooltipTrigger asChild>
                <Label className="text-xs text-muted-foreground whitespace-nowrap cursor-help">Default Markup %</Label>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs max-w-[220px]">
                Set the default profit margin applied to all areas. Higher markup increases profit but may reduce client acceptance.
              </TooltipContent>
            </Tooltip>
            <Input
              type="number"
              value={globalMarkup}
              onChange={(e) => { setGlobalMarkup(parseFloat(e.target.value) || 0); }}
              className="h-8 w-24 text-sm"
              min={0}
              step={5}
            />
          </div>
        </CardContent>
      </Card>

      {/* Pricing table with horizontal scroll */}
      <div className="rounded-lg border shadow-sm overflow-x-auto -webkit-overflow-scrolling-touch">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-background shadow-sm border-b">
          <div className="grid grid-cols-[minmax(140px,1.5fr)_100px_90px_80px_120px] gap-2 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground min-w-[560px]">
            <span className="sticky left-0 bg-background z-[1]">Area</span>
            <span className="text-center">Qty</span>
            <span className="text-right">Cost</span>
            <span className="text-center">Markup</span>
            <span className="text-right">Line Total</span>
          </div>
        </div>

        {/* Rows */}
        <div className="min-w-[560px]">
          {lineItems.map(({ area, costPrice, quantity, markup, sellingPrice, lineTotal }, idx) => {
            const unit = area.acUnits[0];
            const pricing = getPricing(area.id);
            const isOdd = idx % 2 === 1;
            const hasSubs = hasSubItems(area);
            const isExpanded = expandedRows.has(area.id);
            const isBundle = !!area.appliedBundleId;

            return (
              <div key={area.id}>
                <div
                  className={`grid grid-cols-[minmax(140px,1.5fr)_100px_90px_80px_120px] gap-2 px-4 py-3 items-center border-b transition-colors min-h-[52px] ${
                    isBundle ? "bg-blue-50/50 dark:bg-blue-950/20" : isOdd ? "bg-muted/30" : "bg-background"
                  }`}
                >
                  {/* Area name — sticky on mobile */}
                  <div className="min-w-0 flex items-start gap-1.5 sticky left-0 z-[1] bg-inherit">
                    {hasSubs && (
                      <button
                        onClick={() => toggleRowExpanded(area.id)}
                        className="mt-0.5 shrink-0 p-1.5 rounded hover:bg-accent transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center sm:min-h-0 sm:min-w-0 sm:p-0.5"
                        aria-label={isExpanded ? "Collapse sub-items" : "Expand sub-items"}
                      >
                        {isExpanded
                          ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                          : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        }
                      </button>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium truncate">{area.name}</span>
                        {isBundle && (
                          <Badge variant="outline" className="text-[9px] bg-blue-100/50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800 shrink-0">
                            <Package className="h-2.5 w-2.5 mr-0.5" /> Bundle
                          </Badge>
                        )}
                      </div>
                      {unit ? (
                        <Badge variant="outline" className="text-[9px] mt-0.5">
                          {unit.product.product_code} · {unit.btu.toLocaleString()} BTU
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="text-[9px] mt-0.5">No unit</Badge>
                      )}
                    </div>
                  </div>

                  {/* Qty */}
                  <div className="flex justify-center">
                    {unit ? (
                      <QuantityControl
                        value={pricing.quantity}
                        onChange={(v) => { updateAreaPricing(area.id, { quantity: v }); }}
                        min={1}
                        max={20}
                        showSlider={false}
                        size="sm"
                      />
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </div>

                  {/* Cost */}
                  <div className="text-right">
                    <span className="text-xs text-muted-foreground">{unit ? formatCurrency(costPrice) : "—"}</span>
                  </div>

                  {/* Markup */}
                  <div className="flex justify-center">
                    {unit ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Input
                            type="number"
                            value={pricing.markupPercent}
                            onChange={(e) => { updateAreaPricing(area.id, { markupPercent: parseFloat(e.target.value) || 0 }); }}
                            className="h-8 text-xs w-16 text-center min-h-[44px] sm:min-h-0 sm:h-7"
                            min={0}
                            step={5}
                          />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs max-w-[200px]">
                          Higher markup = higher profit but may reduce acceptance rate
                        </TooltipContent>
                      </Tooltip>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </div>

                  {/* Line total + edit */}
                  <div className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <div>
                        <span className="text-xs font-semibold">{unit ? formatCurrency(lineTotal) : "—"}</span>
                        {unit && (
                          <span className="block text-[9px] text-muted-foreground">
                            {formatCurrency(sellingPrice)} × {quantity}
                          </span>
                        )}
                      </div>
                      {hasSubs && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:h-6 sm:w-6 shrink-0"
                          onClick={() => setEditingAreaId(area.id)}
                          aria-label="Edit bundle quantities"
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Collapsible sub-items */}
                {isExpanded && hasSubs && (
                  <div className={`border-b ${isBundle ? "bg-blue-50/30 dark:bg-blue-950/10" : "bg-muted/10"}`}>
                    <AreaSubItems area={area} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Summary Card */}
      <Card className="shadow-md border-primary/10">
        <CardContent className="py-4 px-4 space-y-3">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Subtotal (excl. VAT)</span>
            <span className="font-medium">{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">VAT (15%)</span>
            <span>{formatCurrency(vatAmount)}</span>
          </div>
          <Separator />

          {/* Grand total - highlighted */}
          <div className="flex justify-between items-center text-lg font-bold rounded-lg bg-primary/5 px-3 py-2 -mx-1 text-primary">
            <span>Total Incl. VAT</span>
            <span>{formatCurrency(total)}</span>
          </div>

          {/* Markup impact bar */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                Avg. Markup: {avgMarkup.toFixed(0)}%
              </span>
              <span>
                {avgMarkup <= 20 ? "Conservative" : avgMarkup <= 35 ? "Standard" : "Aggressive"}
              </span>
            </div>
            <div className="relative h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${getMarkupColor(avgMarkup)}`}
                style={{ width: `${Math.min(100, (avgMarkup / 50) * 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-[9px] text-muted-foreground">
              <span>0%</span>
              <span>25%</span>
              <span>50%+</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Generate Quote — delegates to the SAME persisted save-then-send flow
          used by the sidebar's Generate Quote button, so the client selected
          in the header is always attached and the correct estimate/invoice
          PDF template is always used. This step no longer builds its own
          disconnected, client-only quote/PDF. */}
      {onGenerateQuote && (
        <div className="space-y-2">
          <Button
            className="w-full"
            onClick={onGenerateQuote}
            disabled={!allHaveUnits || generating}
          >
            {generating ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…</>
            ) : (
              <><FileDown className="h-4 w-4 mr-2" /> Generate Quote</>
            )}
          </Button>
        </div>
      )}

      {!allHaveUnits && (
        <p className="text-xs text-destructive text-center">
          Some areas have no AC unit selected. Go back to Step 2 to assign units.
        </p>
      )}

      {/* Edit Bundle Dialog */}
      {editingArea && (
        <EditBundleDialog
          area={editingArea}
          open={!!editingAreaId}
          onOpenChange={(o) => { if (!o) setEditingAreaId(null); }}
          onSave={handleBundleSave}
        />
      )}
    </div>
  );
}
