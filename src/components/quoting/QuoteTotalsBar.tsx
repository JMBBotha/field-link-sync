/** R5: slim sticky phone bar: total incl VAT + 70% deposit (units-only orders: full payment). */
const fmt = (n: number) => `R${(Math.round(n * 100) / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function depositLine(total: number, hasInstall: boolean, pct = 70) {
  return hasInstall
    ? { label: `${pct}% deposit`, amount: total * (pct / 100) }
    : { label: "Full payment (units only)", amount: total };
}

export default function QuoteTotalsBar({ total, hasInstall, depositPct = 70 }: { total: number; hasInstall: boolean; depositPct?: number }) {
  const d = depositLine(total, hasInstall, depositPct);
  return (
    <div className="flex items-center justify-between gap-3 border-t bg-card/95 px-4 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] shadow-[0_-2px_8px_rgba(0,0,0,0.06)] backdrop-blur">
      <div className="min-w-0">
        <div className="text-xs text-ink-secondary">Total incl VAT</div>
        <div className="text-base font-semibold tabular-nums text-ink" data-testid="qb-bar-total">{fmt(total)}</div>
      </div>
      <div className="min-w-0 text-right">
        <div className="text-xs text-ink-secondary">{d.label}</div>
        <div className="text-base font-semibold tabular-nums text-ink" data-testid="qb-bar-deposit">{fmt(d.amount)}</div>
      </div>
    </div>
  );
}
