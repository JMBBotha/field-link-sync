/**
 * Area Quote Summary Panel — lives in the right-side 320px column.
 * Shows per-area cost breakdown with itemized counts, markup slider, profit, and grand total.
 */

import { useMemo, useState, useEffect, useRef } from "react";
import { calcSellingPrice, r2, VAT_RATE } from "@/lib/pricing";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { QuoteArea } from "./quoteWizardTypes";

interface AreaQuoteSummaryProps {
  areas: QuoteArea[];
}

const AreaQuoteSummary = ({ areas }: AreaQuoteSummaryProps) => {
  // Derive initial markup from the first AC unit's product default_markup_percent
  const defaultMarkup = useMemo(() => {
    for (const a of areas) {
      if (a.acUnits[0]?.product) {
        const m = (a.acUnits[0].product as any).default_markup_percent;
        if (m != null && m > 0) return m;
      }
    }
    return 35;
  }, [areas]);

  const [markupPercent, setMarkupPercent] = useState(defaultMarkup);
  const prevDefaultRef = useRef(defaultMarkup);
  // Update markup when product data first becomes available
  useEffect(() => {
    if (defaultMarkup !== prevDefaultRef.current && prevDefaultRef.current === 35) {
      setMarkupPercent(defaultMarkup);
      prevDefaultRef.current = defaultMarkup;
    }
  }, [defaultMarkup]);

  const [expandedAreas, setExpandedAreas] = useState<Set<string>>(new Set());

  const toggleArea = (name: string) => {
    setExpandedAreas((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const breakdown = useMemo(() => {
    /** cost_price is the source of truth — already excl VAT, after any discount */
    const getCost = (p: any) => {
      if (p?.cost_price > 0) return p.cost_price;
      if (p?.cost_excl_vat > 0) return p.cost_excl_vat;
      return 0;
    };

    const areaRows = areas
      .filter((a) => a.acUnits.length > 0 || a.materials.length > 0 || a.consumables.length > 0 || a.brackets.length > 0)
      .map((a) => {
        const acCost = a.acUnits.reduce(
          (s, u) => s + getCost(u.product) * u.quantity,
          0
        );
        const acQty = a.acUnits.reduce((s, u) => s + u.quantity, 0);

        const matCost = a.materials.reduce((s, m) => {
          if (m.pricingMode === "unit")
            return s + getCost(m.product) * m.unitQuantity;
          // For length-based: use totalCost if set, otherwise compute from costPerMeter
          const perM = m.costPerMeter || getCost(m.product);
          return s + (m.totalCost || perM * m.adjustedLength);
        }, 0);
        const matCount = a.materials.length;

        const bracketCost = a.brackets.reduce((s, b) => s + b.price * b.quantity, 0);
        const bracketQty = a.brackets.reduce((s, b) => s + b.quantity, 0);

        const consCost = a.consumables.reduce(
          (s, c) => s + getCost(c.product) * c.quantity,
          0
        );
        const consQty = a.consumables.reduce((s, c) => s + c.quantity, 0);

        const cost = acCost + matCost + bracketCost + consCost;
        const totalItems = a.acUnits.length + matCount + a.brackets.length + a.consumables.length;

        return {
          name: a.name,
          cost,
          totalItems,
          acUnits: acQty > 0 ? { count: a.acUnits.length, qty: acQty, cost: acCost } : null,
          materials: matCount > 0 ? { count: matCount, cost: matCost } : null,
          brackets: a.brackets.length > 0 ? { count: a.brackets.length, qty: bracketQty, cost: bracketCost } : null,
          consumables: a.consumables.length > 0 ? { count: a.consumables.length, qty: consQty, cost: consCost } : null,
        };
      });

    const totalCost = areaRows.reduce((s, r) => s + r.cost, 0);
    const totalItems = areaRows.reduce((s, r) => s + r.totalItems, 0);
    const totalAreas = areaRows.length;
    const { sellingExclVat, vatAmount: vat, sellingInclVat } = calcSellingPrice(totalCost, markupPercent);
    const markupAmount = r2(sellingExclVat - totalCost);
    const sellPrice = sellingExclVat;
    const vatAmount = vat;
    const grandTotal = sellingInclVat;

    return { areaRows, totalCost, totalItems, totalAreas, markupAmount, sellPrice, vatAmount, grandTotal };
  }, [areas, markupPercent]);

  const fmt = (n: number) =>
    r2(n).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (breakdown.areaRows.length === 0) {
    return (
      <div
        className="rounded-xl border p-4 space-y-3 m-[3px]"
        style={{
          background:
            "linear-gradient(135deg, rgba(30,107,184,0.12) 0%, rgba(180,195,210,0.18) 100%)",
        }}
      >
        <h4 className="text-sm font-semibold text-foreground">Area Quote Summary</h4>
        <p className="text-xs text-muted-foreground text-center py-6">
          Add AC units or items to areas to see summary
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border p-4 space-y-3 m-[3px]"
      style={{
        background:
          "linear-gradient(135deg, rgba(30,107,184,0.12) 0%, rgba(180,195,210,0.18) 100%)",
      }}
    >
      {/* Header with running count */}
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">Area Quote Summary</h4>
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5">
          {breakdown.totalAreas} area{breakdown.totalAreas !== 1 ? "s" : ""} · {breakdown.totalItems} item{breakdown.totalItems !== 1 ? "s" : ""}
        </Badge>
      </div>

      {/* Per-area breakdown with expandable details */}
      <div className="space-y-1">
        {breakdown.areaRows.map((z) => {
          const isExpanded = expandedAreas.has(z.name);
          return (
            <div key={z.name}>
              <button
                type="button"
                className="w-full flex items-center justify-between text-xs py-1 hover:bg-muted/30 rounded px-1 -mx-1 transition-colors"
                onClick={() => toggleArea(z.name)}
              >
                <span className="flex items-center gap-1 text-muted-foreground">
                  {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  <span className="font-medium text-foreground">{z.name}</span>
                  <Badge variant="outline" className="text-[9px] px-1 py-0">
                    {z.totalItems}
                  </Badge>
                </span>
                <span className="font-semibold text-foreground">R{fmt(z.cost)}</span>
              </button>

              {isExpanded && (
                <div className="ml-5 space-y-0.5 pb-1">
                  {z.acUnits && (
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>AC Units ({z.acUnits.qty})</span>
                      <span>R{fmt(z.acUnits.cost)}</span>
                    </div>
                  )}
                  {z.materials && (
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>Materials ({z.materials.count})</span>
                      <span>R{fmt(z.materials.cost)}</span>
                    </div>
                  )}
                  {z.brackets && (
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>Brackets ({z.brackets.qty})</span>
                      <span>R{fmt(z.brackets.cost)}</span>
                    </div>
                  )}
                  {z.consumables && (
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>Consumables/Bundles ({z.consumables.qty})</span>
                      <span>R{fmt(z.consumables.cost)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Separator />

      {/* Cost subtotal */}
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Total Cost</span>
        <span className="font-medium">R{fmt(breakdown.totalCost)}</span>
      </div>

      {/* Markup slider */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Markup
          </label>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              min={0}
              max={200}
              value={markupPercent}
              onChange={(e) => setMarkupPercent(Math.max(0, Number(e.target.value)))}
              className="h-6 w-14 text-xs text-right px-1"
            />
            <span className="text-xs text-muted-foreground">%</span>
          </div>
        </div>
        <Slider
          min={0}
          max={100}
          step={1}
          value={[markupPercent]}
          onValueChange={([v]) => setMarkupPercent(v)}
          className="py-1"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Markup Amount</span>
          <span className="font-medium text-primary">+R{fmt(breakdown.markupAmount)}</span>
        </div>
      </div>

      <Separator />

      {/* Sell price, VAT, Grand Total */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Sell Price (excl. VAT)</span>
          <span>R{fmt(breakdown.sellPrice)}</span>
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>VAT (15%)</span>
          <span>R{fmt(breakdown.vatAmount)}</span>
        </div>
        <div className="flex justify-between items-center text-sm font-bold text-primary rounded-md bg-primary/10 dark:bg-primary/15 px-3 py-1.5 -mx-1">
          <span>Grand Total</span>
          <span>R{fmt(breakdown.grandTotal)}</span>
        </div>
      </div>

      {/* Profit line */}
      <div className="flex justify-between items-center text-xs rounded-md bg-accent/50 border border-accent px-2.5 py-1.5 -mx-0.5">
        <span className="text-accent-foreground font-medium">Profit</span>
        <span className="text-accent-foreground font-bold">
          R{fmt(breakdown.markupAmount)}
        </span>
      </div>
    </div>
  );
};

export default AreaQuoteSummary;
