import type { Recon } from "@/lib/stockRecon";

const R = (n: number | null) => (n == null ? "—" : `R${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/** Read-only check before Confirm: every line → item, qty, target, cost; then a total per job. Red box lists what blocks Confirm. */
export default function ReceiveReconTable({ recon }: { recon: Recon }) {
  return (
    <div className="space-y-2" data-testid="receive-recon">
      <div className="text-sm font-semibold">Check before confirming</div>
      <div className="rounded-xl border overflow-hidden text-sm">
        <div className="hidden sm:grid grid-cols-[1.7fr_.5fr_1.4fr_.9fr] gap-2 bg-muted/50 px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
          <span>Note line → item</span><span className="text-right">Qty</span><span>Bucket / job</span><span className="text-right">Cost excl</span>
        </div>
        {recon.lines.map((l) => (
          <div key={l.index} data-testid="recon-line" className={`grid grid-cols-[1fr_auto] sm:grid-cols-[1.7fr_.5fr_1.4fr_.9fr] gap-x-2 gap-y-0.5 px-2 py-1.5 border-t first:border-t-0 ${l.issue ? "bg-red-50 text-red-900" : ""}`}>
            <div className="min-w-0"><div className="truncate font-medium">{l.item}</div>
              <div className="text-[11px] text-muted-foreground truncate">{l.model}{l.half ? ` · ${l.half}` : ""}</div>
              {l.issue && <div className="text-[11px] font-medium text-red-700">{l.issue}</div>}</div>
            <div className="text-right sm:order-none">× {l.qty}</div>
            <div className={`text-xs sm:text-sm ${l.target_kind === "none" ? "text-red-700 font-semibold" : "text-muted-foreground sm:text-foreground"}`}>{l.target}</div>
            <div className="text-right">{R(l.line_cost)}</div>
          </div>
        ))}
      </div>
      <div className="rounded-xl border text-sm" data-testid="recon-jobs">
        {recon.jobs.map((g) => (
          <div key={g.job_id ?? g.label} className={`px-2 py-1.5 border-t first:border-t-0 ${g.issues.length ? "bg-red-50" : ""}`}>
            <div className="flex justify-between gap-2"><span className="font-medium truncate">{g.label} <span className="text-[11px] text-muted-foreground">({g.lines} line{g.lines === 1 ? "" : "s"})</span></span><span className="font-medium">{R(g.cost)}</span></div>
            {g.issues.map((i, k) => <div key={k} className="text-[11px] font-medium text-red-700">{i}</div>)}
          </div>
        ))}
        <div className="flex justify-between px-2 py-1.5 border-t font-semibold"><span>Total</span><span>{R(recon.total)}</span></div>
      </div>
      {!recon.ok && (
        <div role="alert" data-testid="recon-blocked" className="rounded-xl border border-red-500 bg-red-50 p-2 text-sm text-red-800">
          <div className="font-semibold">Fix these before confirming:</div>
          <ul className="list-disc pl-5 text-xs">{recon.problems.map((p, k) => <li key={k}>{p}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
