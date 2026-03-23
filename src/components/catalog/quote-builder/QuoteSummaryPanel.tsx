import { useMemo } from "react";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatRand } from "@/utils/formatRand";
import { r2, VAT_RATE } from "@/utils/pricing";
import type { Basket } from "../QuoteBuilderTab";
import { getEffectiveUnitPrices } from "../QuoteBuilderTab";
import QuoteBrochureSection from "@/components/brochures/QuoteBrochureSection";

interface QuoteSummaryPanelProps {
  baskets: Basket[];
  onGenerateQuote?: () => void;
  quoteId?: string | null;
}

const QuoteSummaryPanel = ({ baskets, onGenerateQuote, quoteId }: QuoteSummaryPanelProps) => {
  const summary = useMemo(() => {
    let grandTotal = 0;
    let totalCost = 0;

    baskets.forEach((b) => {
      b.items.forEach((i) => {
        if (i.isBundle && i.bundleUnitPrice) {
          const sell = i.bundlePricingType === "p/meter"
            ? i.bundleUnitPrice * (i.length || 1)
            : i.bundleUnitPrice * i.quantity;
          const cost = i.bundleUnitCost
            ? (i.bundlePricingType === "p/meter"
              ? i.bundleUnitCost * (i.length || 1)
              : i.bundleUnitCost * i.quantity)
            : sell * 0.7;
          grandTotal += sell;
          totalCost += cost;
        } else if (i.product.sold_in_length && i.product.price_per_metre && i.length) {
          const sell = i.product.price_per_metre * i.length;
          const { unitCost } = getEffectiveUnitPrices(i.product, true);
          grandTotal += sell;
          totalCost += unitCost * i.length;
        } else {
          // selling_price already has discount+markup baked in — just multiply by qty
          const { unitSell, unitCost } = getEffectiveUnitPrices(i.product);
          grandTotal += unitSell * i.quantity;
          totalCost += unitCost * i.quantity;
        }
      });
    });

    const subtotal = r2(grandTotal);
    const vat = r2(grandTotal * VAT_RATE);
    const markup = totalCost > 0 ? ((grandTotal - totalCost) / totalCost) * 100 : 0;

    return { subtotal, vat, grandTotal: r2(subtotal + vat), markup };
  }, [baskets]);

  // Extract model codes from basket items for brochure matching
  const lineItemModelCodes = useMemo(() => {
    const codes: string[] = [];
    baskets.forEach((b) => {
      b.items.forEach((i) => {
        if (i.product.product_code) codes.push(i.product.product_code);
        if (i.bundleItems) {
          i.bundleItems.forEach((bi) => {
            if (bi.product.product_code) codes.push(bi.product.product_code);
          });
        }
      });
    });
    return codes;
  }, [baskets]);

  const markupCapped = Math.min(summary.markup, 55);
  const markupPercent = Math.max(0, (markupCapped / 55) * 100);

  const markupLabel = summary.markup >= 25 && summary.markup <= 50 ? "Standard" : 
                      summary.markup < 25 ? "Low" : "High";

  const markupBadgeVariant = markupLabel === "Standard" ? "default" as const
    : markupLabel === "Low" ? "destructive" as const
    : "secondary" as const;

  const markupBadgeClass = markupLabel === "Standard"
    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800"
    : markupLabel === "Low"
      ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800"
      : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800";

  return (
    <div className="space-y-4">
      {/* Subtotal */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Subtotal (excl. VAT)</span>
        <span className="font-medium text-foreground tabular-nums">{formatRand(summary.subtotal)}</span>
      </div>

      {/* VAT */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">VAT (15%)</span>
        <span className="font-medium text-foreground tabular-nums">{formatRand(summary.vat)}</span>
      </div>

      {/* Total banner */}
      <div className="flex items-center justify-between rounded-lg px-4 py-3 bg-primary/10">
        <span className="text-sm font-bold text-primary">Total Incl. VAT</span>
        <span className="text-lg font-bold text-primary tabular-nums">{formatRand(summary.grandTotal)}</span>
      </div>

      {/* Markup bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            Avg. Markup: <span className="font-semibold text-foreground">{summary.markup.toFixed(0)}%</span>
          </span>
          <Badge variant="outline" className={`text-[10px] font-medium px-1.5 py-0.5 ${markupBadgeClass}`}>
            {markupLabel}
          </Badge>
        </div>
        <div className="relative h-3 rounded-full bg-muted overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
            style={{
              width: `${markupPercent}%`,
              background: markupLabel === "Low"
                ? "linear-gradient(90deg, hsl(0 84% 60%), hsl(25 95% 53%))"
                : markupLabel === "Standard"
                  ? "linear-gradient(90deg, hsl(142 71% 45%), hsl(84 81% 44%))"
                  : "linear-gradient(90deg, hsl(45 93% 47%), hsl(38 92% 50%))"
            }}
          />
          {/* Tick marks */}
          <div className="absolute inset-0 flex items-center">
            <div className="absolute left-0 w-px h-full bg-border" />
            <div className="absolute left-[45.5%] w-px h-full bg-border/50" />
            <div className="absolute left-[90.9%] w-px h-full bg-border/50" />
          </div>
        </div>
        <div className="flex justify-between text-[9px] text-muted-foreground">
          <span>0%</span>
          <span className="ml-[35%]">25%</span>
          <span>50%+</span>
        </div>
      </div>

      {/* Generate Quote button */}
      <Button
        className="w-full h-11 text-sm font-semibold gap-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-gray-900"
        onClick={onGenerateQuote}
      >
        <FileText className="h-4 w-4" />
        Generate Quote
      </Button>
    </div>
  );
};

export default QuoteSummaryPanel;
