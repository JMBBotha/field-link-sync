import { Badge } from "@/components/ui/badge";
import { unitShort } from "@/lib/stockUnits";
import { withBucket, type PreviewRow, type ReceiveAction, type StockBucket } from "@/lib/stockReceive";

export interface JobOption { id: string; label: string }
const UNIT_ACTIONS: [ReceiveAction, string][] = [["reserve", "For this job"], ["stock", "General stock"], ["installed", "On site"], ["skip", "Skip"]];
const POOL_ACTIONS: [ReceiveAction, string][] = [["stock", "Materials pool"], ["skip", "Skip"]];
const BUCKET: Record<StockBucket, string> = { job_unit: "Job-reserved unit", general_unit: "General stock", material_pool: "Materials pool" };
const R = (n: number | null) => (n == null ? "—" : `R${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/** Presentational: one row per product line, action + job per line. Stacks into cards under 640px. */
export default function ReceivePreviewTable({ rows, jobs, isInvoice, onChange }: {
  rows: PreviewRow[]; jobs: JobOption[]; isInvoice: boolean; onChange: (i: number, patch: Partial<PreviewRow>) => void;
}) {
  return (
    <div className="space-y-2" data-testid="receive-preview">
      <div className="hidden sm:grid grid-cols-[1.5fr_.55fr_.85fr_1.15fr_1.35fr] gap-2 px-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        <span>Product</span><span className="text-right">Qty</span><span className="text-right">{isInvoice ? "Unit cost" : "Cost (catalogue)"}</span><span>Action</span><span>Job</span>
      </div>
      {rows.map((r, i) => {
        const unit = r.map ? unitShort(r.map.stock_unit) : "ea";
        const needsJob = r.bucket === "job_unit";
        const actions = r.bucket === "material_pool" || (r.match.product && r.match.product.product_type !== "ac_unit") ? POOL_ACTIONS : UNIT_ACTIONS;
        return (
          <div key={i} className={`rounded-xl border p-2 sm:grid sm:grid-cols-[1.5fr_.55fr_.85fr_1.15fr_1.35fr] sm:gap-2 sm:items-center space-y-2 sm:space-y-0 ${r.price.level === "warn" ? "border-amber-400 bg-amber-50/60" : ""}`}>
            <div className="min-w-0">
              <div className="font-medium text-sm truncate">{r.match.product?.short_name || r.match.product?.name || r.line.description}</div>
              <div className="text-xs text-muted-foreground truncate">{r.line.model_number}{r.half ? ` · ${r.half}` : ""} {r.match.product ? "" : "· not matched"}</div>
              {r.bucket && <Badge variant="outline" className="mt-1 text-[11px]" data-testid={`bucket-${r.bucket}`}>{BUCKET[r.bucket]}</Badge>}
              {r.notes.map((n, k) => <div key={k} className={n.startsWith("Code alias") ? "text-[11px] font-medium text-amber-600" : "text-[11px] text-muted-foreground"}>{n.startsWith("Code alias") ? `⚠ ${n}` : n}</div>)}
              {r.price.level !== "none" && <Badge variant={r.price.level === "warn" ? "destructive" : "secondary"} className="mt-1 text-[11px]">{r.price.level === "warn" ? "⚠ " : ""}{r.price.text}</Badge>}
            </div>
            <div className="flex sm:block justify-between text-sm sm:text-right"><span className="sm:hidden text-muted-foreground">Qty</span>
              <span>{r.line.qty}{r.map && r.map.pack_size !== 1 ? <span className="block text-[11px] text-muted-foreground">= {r.stock_qty} {unit}</span> : null}</span></div>
            <div className="flex sm:block justify-between text-sm sm:text-right"><span className="sm:hidden text-muted-foreground">Cost</span>
              <span>{R(r.unit_cost_pack)}{r.map && r.map.pack_size !== 1 && r.cost_per_stock_unit != null ? <span className="block text-[11px] text-muted-foreground">{R(r.cost_per_stock_unit)}/{unit}</span> : null}
                {r.vat_amount != null ? <span className="block text-[11px] text-muted-foreground">excl · VAT {R(r.vat_amount)}</span> : null}</span></div>
            <select aria-label="Action" className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={actions.some(([k]) => k === r.action) ? r.action : actions[0][0]}
              onChange={(e) => onChange(i, withBucket({ ...r, action: e.target.value as ReceiveAction }))}>
              {actions.map(([k, l]) => <option key={k} value={k} disabled={!r.match.product && k !== "skip"}>{l}</option>)}
            </select>
            <select aria-label="Job" className={`w-full h-9 rounded-md border bg-background px-2 text-sm ${needsJob && !r.job_id ? "border-destructive" : ""}`}
              value={r.job_id ?? ""} disabled={!needsJob} onChange={(e) => onChange(i, { job_id: e.target.value || null })}>
              <option value="">{needsJob ? "Choose job…" : "—"}</option>
              {jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
            </select>
            {(r.bucket === "job_unit" || r.bucket === "general_unit") && <input aria-label="Serial no." placeholder="Serial no. (optional)" className="w-full h-8 rounded-md border bg-background px-2 text-xs sm:col-span-full"
              value={r.serial_no ?? ""} onChange={(e) => onChange(i, { serial_no: e.target.value })} />}
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">{isInvoice ? "Confirming adds stock at the invoice price (excl VAT). Job-reserved units are booked to that job. General stock stays unassigned. Materials go to the pool." : "Delivery note: nothing is added to stock. Job-reserved units get a Projects line; stock arrives with the invoice."}</p>
    </div>
  );
}
