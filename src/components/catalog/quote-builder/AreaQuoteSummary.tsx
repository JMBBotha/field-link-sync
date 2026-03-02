/**
 * Area Quote Summary Panel — lives in the right-side 320px column.
 * Shows per-area cost breakdown, markup slider, profit, and grand total.
 */

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import type { QuoteArea } from "./quoteWizardTypes";
import { computeAreaSubtotal } from "./quoteWizardTypes";

interface AreaQuoteSummaryProps {
  areas: QuoteArea[];
}

const AreaQuoteSummary = ({ areas }: AreaQuoteSummaryProps) => {
  const [markupPercent, setMarkupPercent] = useState(25);

  const breakdown = useMemo(() => {
    const areaRows = areas
      .filter((a) => a.acUnits.length > 0 || a.materials.length > 0 || a.consumables.length > 0 || a.brackets.length > 0)
      .map((a) => {
        const acCost = a.acUnits.reduce(
          (s, u) => s + (u.product.selling_price || u.product.cost_incl_vat || 0) * u.quantity,
          0
        );
        const matCost = a.materials.reduce((s, m) => {
          if (m.pricingMode === "unit")
            return s + (m.product.selling_price || m.product.cost_incl_vat || 0) * m.unitQuantity;
          return s + m.totalCost;
        }, 0);
        const bracketCost = a.brackets.reduce((s, b) => s + b.price * b.quantity, 0);
        const consCost = a.consumables.reduce(
          (s, c) => s + (c.product.selling_price || c.product.cost_incl_vat || 0) * c.quantity,
          0
        );
        const cost = acCost + matCost + bracketCost + consCost;
        const items =
          a.acUnits.length + a.materials.length + a.brackets.length + a.consumables.length;
        return { name: a.name, cost, items };
      });

    const totalCost = areaRows.reduce((s, r) => s + r.cost, 0);
    const markupAmount = totalCost * (markupPercent / 100);
    const sellPrice = totalCost + markupAmount;
    const vatAmount = sellPrice * 0.15;
    const grandTotal = sellPrice + vatAmount;

    return { areaRows, totalCost, markupAmount, sellPrice, vatAmount, grandTotal };
  }, [areas, markupPercent]);

  const fmt = (n: number) =>
    n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
          Add AC units to areas to see summary
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
      <h4 className="text-sm font-semibold text-foreground">Area Quote Summary</h4>

      {/* Per-area breakdown */}
      <div className="space-y-1.5">
        {breakdown.areaRows.map((z) => (
          <div key={z.name} className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {z.name}
              <Badge variant="outline" className="ml-1.5 text-[9px] px-1 py-0">
                {z.items} items
              </Badge>
            </span>
            <span className="font-medium">R{fmt(z.cost)}</span>
          </div>
        ))}
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
