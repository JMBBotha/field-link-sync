import { Badge } from "@/components/ui/badge";
import { unitShort } from "@/lib/stockUnits";
import type { PreviewRow, ReceiveAction } from "@/lib/stockReceive";

export interface JobOption { id: string; label: string }
const ACTIONS: [ReceiveAction, string][] = [["stock", "Into stock"], ["reserve", "Reserve for job"], ["installed", "Already installed"], ["skip", "Skip"]];
const R = (n: number | null) => (n == null ? "—" : `R${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/** Presentational: one row per product line, action + job per line. Stacks into cards under 640px. */
export default function ReceivePreviewTable({ rows, jobs, isInvoice, onChange }: {
  rows: PreviewRow[]; jobs: JobOption[]; isInvoice: boolean; onChange: (i: number, patch: Partial<PreviewRow>) => void;
}) {
  return (
    <div className="space-y-2" data-testid="receive-preview">
      <div className="hidden sm:grid grid-cols-[1.6fr_.6fr_.9fr_1.2fr_1.4fr] gap-2 px-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        <span>Product</span><span className="text-right">Qty</span><span className="text-right">{isInvoice ? "Unit cost" : "Cost (catalogue)"}</span><span>Action</span><span>Job</span>
      </div>
      {rows.map((r, i) => {
        const unit = r.map ? unitShort(r.map.stock_unit) : "ea";
        const needsJob = r.action === "reserve" || r.action === "installed";
        return (
          <div key={i} className={`rounded-xl border p-2 sm:grid sm:grid-cols-[1.6fr_.6fr_.9fr_1.2fr_1.4fr] sm:gap-2 sm:items-center space-y-2 sm:space-y-0 ${r.price.level === "warn" ? "border-amber-400 bg-amber-50/60" : ""}`}>
            <div className="min-w-0">
              <div className="font-medium text-sm truncate">{r.match.product?.short_name || r.match.product?.name || r.line.description}</div>
              <div className="text-xs text-muted-foreground truncate">{r.line.model_number} {r.match.product ? "" : "· not matched"}</div>
              {r.notes.map((n, k) => <div key={k} className="text-[11px] text-muted-foreground">{n}</div>)}
              {r.price.level !== "none" && <Badge variant={r.price.level === "warn" ? "destructive" : "secondary"} className="mt-1 text-[11px]">{r.price.level === "warn" ? "⚠ " : ""}{r.price.text}</Badge>}
            </div>
            <div className="flex sm:block justify-between text-sm sm:text-right"><span className="sm:hidden text-muted-foreground">Qty</span>
              <span>{r.line.qty}{r.map && r.map.pack_size !== 1 ? <span className="block text-[11px] text-muted-foreground">= {r.stock_qty} {unit}</span> : null}</span></div>
            <div className="flex sm:block justify-between text-sm sm:text-right"><span className="sm:hidden text-muted-foreground">Cost</span>
              <span>{R(r.unit_cost_pack)}{r.map && r.map.pack_size !== 1 && r.cost_per_stock_unit != null ? <span className="block text-[11px] text-muted-foreground">{R(r.cost_per_stock_unit)}/{unit}</span> : null}</span></div>
            <select aria-label="Action" className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={r.action}
              onChange={(e) => onChange(i, { action: e.target.value as ReceiveAction })} disabled={!r.match.product && r.action === "skip" && false}>
              {ACTIONS.map(([k, l]) => <option key={k} value={k} disabled={!r.match.product && k !== "skip"}>{l}</option>)}
            </select>
            <select aria-label="Job" className={`w-full h-9 rounded-md border bg-background px-2 text-sm ${needsJob && !r.job_id ? "border-destructive" : ""}`}
              value={r.job_id ?? ""} disabled={!needsJob} onChange={(e) => onChange(i, { job_id: e.target.value || null })}>
              <option value="">{needsJob ? "Choose job…" : "—"}</option>
              {jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
            </select>
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">{isInvoice ? "Confirming adds stock at the invoice price. Reserved lines are allocated to the job." : "Delivery note: nothing is added to stock now. Reserved lines get a Projects line on the job; stock arrives with the invoice."}</p>
    </div>
  );
}
