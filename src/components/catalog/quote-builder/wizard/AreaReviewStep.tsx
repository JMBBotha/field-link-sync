import { formatRand } from "@/utils/formatRand";
import type { QuoteTotals } from "@/utils/quoteTransformers";
import type { AreaReviewSummary } from "@/utils/areaReviewTotals";
import type { QuoteArea } from "../quoteWizardTypes";
import { ReviewWithLabourStep } from "./TimeAllocationStep";

/** Review: per area AND in total, the same figures as the Visual PDF side summary and header (shared computeQuoteTotals). */
function Figures({ t, hours, rate, showCost, missing }: { t: QuoteTotals; hours: number; rate: number | null; showCost: boolean; missing?: boolean }) {
  const line = (label: string, value: string, cls = "") => (
    <div className={`flex justify-between ${cls}`}><span className="text-muted-foreground">{label}</span><span className="tabular-nums">{value}</span></div>
  );
  const itemsMarkup = t.labourTotal > 0 ? t.unitsMaterialsMarkup : t.totalCost > 0 ? t.avgMarkup : null;
  return (
    <div className="space-y-0.5">
      {showCost && line("Cost of items (excl. VAT)", formatRand(Math.max(0, t.totalCost - t.labourTotal)))}
      {showCost && line("Markup on items (on cost)", itemsMarkup == null ? "—" : `${itemsMarkup.toFixed(1)}%`)}
      {showCost && line("GP (sell excl. VAT − cost)", formatRand(t.profit), "font-semibold")}
      {missing ? <div className="text-destructive">Labour missing — set it in the Time step</div>
        : line("Labour", hours > 0 ? `${hours} h${rate != null ? ` × ${formatRand(rate)}` : ""} = ${formatRand(t.labourTotal)}` : "—")}
      {showCost && t.noCostCount > 0 && <div className="text-amber-700">{t.noCostCount} line{t.noCostCount !== 1 ? "s have" : " has"} no cost (left out of markup/GP)</div>}
      {line("Subtotal (excl. VAT)", formatRand(t.subtotal), "border-t pt-1")}
      {line("VAT (15%)", formatRand(t.vatAmount))}
      {line("Total incl. VAT", formatRand(t.total), "font-bold")}
    </div>
  );
}

export default function AreaReviewStep({ areas, summary }: { areas: QuoteArea[]; onAreasChange?: (a: QuoteArea[]) => void; summary?: AreaReviewSummary }) {
  if (!summary) return <ReviewWithLabourStep areas={areas} />;
  const { rows, totals: t, showCost } = summary;
  const jobLabour = rows.some((r) => r.name === "Job labour");
  return (
    <div className="space-y-3 text-xs" data-testid="review-step">
      <h3 className="text-sm font-medium">Quote review</h3>
      {rows.length === 0 && <p className="text-muted-foreground">No areas defined.</p>}
      {rows.map((r) => (
        <div key={r.name} className="rounded border bg-card p-3" data-testid="review-area">
          <div className="mb-1 text-sm font-medium">{r.name}</div>
          <Figures t={r.totals} hours={r.hours} rate={r.rate} showCost={showCost} missing={r.hasItems && r.hours <= 0 && !jobLabour} />
        </div>
      ))}
      <div className="rounded border-2 border-primary/30 bg-primary/5 p-3" data-testid="review-totals">
        <div className="mb-1 text-sm font-bold">Quote total</div>
        {t.discountAmount > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Discount (areas above are before discount)</span><span className="tabular-nums">−{formatRand(t.discountAmount)}</span></div>}
        {showCost && <div className="flex justify-between"><span className="text-muted-foreground">Our cost incl. labour (as side summary)</span><span className="tabular-nums">{formatRand(t.totalCost)}</span></div>}
        {showCost && <div className="flex justify-between"><span className="text-muted-foreground">Overall markup (on cost, incl. labour)</span><span className="tabular-nums">{t.avgMarkup.toFixed(1)}%</span></div>}
        <Figures t={t} hours={rows.reduce((s, r) => s + r.hours, 0)} rate={null} showCost={showCost} />
      </div>
    </div>
  );
}
