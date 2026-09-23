import { useMemo, useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { useOptionalQuoteContext } from "@/contexts/QuoteContext";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatRand } from "@/utils/formatRand";
import type { Basket } from "../QuoteBuilderTab";
import { computeBasketsQuoteTotals } from "@/utils/quoteBasketTotals";
import QuoteBrochureSection from "@/components/brochures/QuoteBrochureSection";
import ProductSalesCards from "@/components/brochures/ProductSalesCards";
import { blendedMarkupHealth, BLENDED_MARKUP_BAR_MAX, type QuoteTotals } from "@/utils/quoteTransformers";

interface QuoteSummaryPanelProps {
  baskets: Basket[];
  totals?: QuoteTotals;
  onGenerateQuote?: () => void;
  quoteId?: string | null;
}

const QuoteSummaryPanel = ({ baskets, totals, onGenerateQuote, quoteId }: QuoteSummaryPanelProps) => {
  const summary = useMemo(() => totals ?? computeBasketsQuoteTotals(baskets), [baskets, totals]);

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

  const markupPercent = Math.max(0, Math.min(100, (summary.avgMarkup / BLENDED_MARKUP_BAR_MAX) * 100));
  const markupLabel = blendedMarkupHealth(summary.avgMarkup);

  // Quote-level Units % / Materials % (only inside an open quote)
  const quoteCtx = useOptionalQuoteContext();
  const [unitsDraft, setUnitsDraft] = useState<string>("");
  const [matsDraft, setMatsDraft] = useState<string>("");
  useEffect(() => {
    if (!quoteCtx) return;
    setUnitsDraft(String(quoteCtx.markupRates.units));
    setMatsDraft(String(quoteCtx.markupRates.materials));
  }, [quoteCtx?.markupRates.units, quoteCtx?.markupRates.materials]); // eslint-disable-line react-hooks/exhaustive-deps
  const commitRates = () => {
    if (!quoteCtx) return;
    const u = Number(unitsDraft), m = Number(matsDraft);
    if (!Number.isFinite(u) || !Number.isFinite(m)) return;
    if (u === quoteCtx.markupRates.units && m === quoteCtx.markupRates.materials) return;
    void quoteCtx.setMarkupRates({ units: u, materials: m });
  };

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
        <span className="font-medium text-foreground tabular-nums">{formatRand(summary.vatAmount)}</span>
      </div>

      {/* Total banner */}
      <div className="flex items-center justify-between rounded-lg px-4 py-3 bg-primary/10">
        <span className="text-sm font-bold text-primary">Total Incl. VAT</span>
        <span className="text-lg font-bold text-primary tabular-nums">{formatRand(summary.total)}</span>
      </div>

      {quoteCtx && (
        <div className="rounded-md border border-border p-2 space-y-1.5 text-xs">
          <div className="font-medium text-foreground">Markup on cost for this quote</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-0.5">
              <span className="text-muted-foreground">Units %</span>
              <Input type="number" inputMode="decimal" className="h-8 text-xs" value={unitsDraft}
                onChange={(e) => setUnitsDraft(e.target.value)} onBlur={commitRates}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
            </label>
            <label className="space-y-0.5">
              <span className="text-muted-foreground">Materials %</span>
              <Input type="number" inputMode="decimal" className="h-8 text-xs" value={matsDraft}
                onChange={(e) => setMatsDraft(e.target.value)} onBlur={commitRates}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
            </label>
          </div>
          <p className="text-[10px] text-muted-foreground">Labour is charged at its flat rate with no markup. Changing a % reprices every line of that type on this quote.</p>
        </div>
      )}

      {/* Cost & profit (ex VAT) — blended over lines with a known cost */}
      {summary.totalCost > 0 && (
        <div className="rounded-md border border-border p-2 space-y-1 text-xs">
          {summary.discountAmount > 0 && (
            <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="tabular-nums">−{formatRand(summary.discountAmount)}</span></div>
          )}
          <div className="flex justify-between"><span className="text-muted-foreground">Our cost (excl. VAT)</span><span className="tabular-nums">{formatRand(summary.totalCost)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Gross profit</span><span className="tabular-nums font-semibold text-foreground">{formatRand(summary.profit)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Overall markup (on cost)</span><span className="tabular-nums">{summary.avgMarkup.toFixed(1)}%</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Overall margin (on sell)</span><span className="tabular-nums">{summary.marginPercent.toFixed(1)}%</span></div>
          {summary.unitsMarkup != null && (
            <div className="flex justify-between"><span className="text-muted-foreground">Units markup</span><span className="tabular-nums">{summary.unitsMarkup.toFixed(0)}%</span></div>
          )}
          {summary.materialsMarkup != null && (
            <div className="flex justify-between"><span className="text-muted-foreground">Materials markup</span><span className="tabular-nums">{summary.materialsMarkup.toFixed(0)}%</span></div>
          )}
          {summary.labourTotal > 0 && (
            <div className="flex justify-between"><span className="text-muted-foreground">Labour (flat rate, no markup)</span><span className="tabular-nums">{formatRand(summary.labourTotal)}</span></div>
          )}
        </div>
      )}

      {summary.noCostCount > 0 && (
        <p className="text-[10px] text-muted-foreground">
          {summary.noCostCount} {summary.noCostCount === 1 ? "line has" : "lines have"} no cost, so {summary.noCostCount === 1 ? "it is" : "they are"} left out of the markup and margin figures.
        </p>
      )}

      {/* Markup bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            Overall markup: <span className="font-semibold text-foreground">{summary.avgMarkup.toFixed(0)}%</span>
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
            <div className="absolute left-[25%] w-px h-full bg-border/50" />
            <div className="absolute left-[60%] w-px h-full bg-border/50" />
          </div>
        </div>
        <div className="relative h-3 text-[9px] text-muted-foreground">
          <span className="absolute left-0">0%</span>
          <span className="absolute left-[25%] -translate-x-1/2">25%</span>
          <span className="absolute left-[60%] -translate-x-1/2">60%</span>
          <span className="absolute right-0">100%+</span>
        </div>
      </div>

      {/* Sales cards (AR40) */}
      <div className="border-t border-border pt-3">
        <ProductSalesCards lineItemModelCodes={lineItemModelCodes} />
      </div>

      {/* Brochures section */}
      <div className="border-t border-border pt-3">
        <QuoteBrochureSection quoteId={quoteId} lineItemModelCodes={lineItemModelCodes} />
      </div>

      {/* Send button: saves the quote, then offers the client link (copy /
          WhatsApp) plus email PDF via the send dialog */}
      <Button
        className="w-full h-11 text-sm font-semibold gap-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-gray-900"
        onClick={onGenerateQuote}
      >
        <Send className="h-4 w-4" />
        Send
      </Button>
    </div>
  );
};

export default QuoteSummaryPanel;
