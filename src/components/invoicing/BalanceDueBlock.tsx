import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { type BalanceInfo, finalPaymentLine, fmtDay, fmtDayTime, rand, toLocalInput, fromLocalInput } from "@/lib/balanceDue";
import { PaymentReminderDialog } from "@/components/invoicing/PaymentReminderDialog";

const TONE = { blue: "text-[#1590D6]", green: "text-emerald-600", amber: "text-[#B5730A]", red: "text-[#C9373C]" } as const;

export function useBalanceInfo(invoiceId?: string | null) {
  return useQuery({
    queryKey: ["invoice-balance", invoiceId], enabled: !!invoiceId,
    queryFn: async () => { const { data, error } = await (supabase as any).rpc("invoice_balance_info", { p_invoice: invoiceId }); if (error) throw error; return data as BalanceInfo | null; },
  });
}

/** Installation · Deposit · Balance · Final payment, on every client view (Johan 31 Oct 09:56). Edits are logged server-side. */
export function BalanceDueBlock({ invoiceId, compact, className, onRecordPayment }: { invoiceId: string; compact?: boolean; className?: string; onRecordPayment?: () => void }) {
  const qc = useQueryClient();
  const { data: b } = useBalanceInfo(invoiceId);
  const [edit, setEdit] = useState<"install" | "due" | null>(null);
  const [val, setVal] = useState(""); const [busy, setBusy] = useState(false); const [preview, setPreview] = useState(false);
  if (!b) return null;
  const st = (b.status || "").toLowerCase();
  if (st === "draft" && !b.is_balance) return null;
  const refresh = () => { qc.invalidateQueries({ queryKey: ["invoice-balance"] }); qc.invalidateQueries({ queryKey: ["invoice-due"] }); qc.invalidateQueries({ queryKey: ["payment-followups"] }); };
  const final = finalPaymentLine(b);
  const closed = ["void", "cancelled", "paid"].includes(st) || b.balance <= 0.005;
  const save = async (override?: string) => {
    const v = override ?? val;
    setBusy(true);
    const r = edit === "install"
      ? await (supabase as any).rpc("set_job_install_date", { p_job: b.job_id, p_at: fromLocalInput(v), p_reason: "Balance block" })
      : await (supabase as any).rpc("set_invoice_due_date", { p_invoice: b.invoice_id, p_due: v || null, p_reason: v ? "Expected final payment (balance block)" : "Back to due on completion" });
    setBusy(false);
    if (r.error) return toast.error(r.error.message);
    toast.success("Saved and logged"); setEdit(null); refresh();
  };
  const cell = "min-w-0 rounded-xl bg-white/80 px-3 py-2 dark:bg-white/5";
  const lab = "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";
  const editBtn = (k: "install" | "due", v: string) => (
    <button type="button" aria-label={k === "install" ? "Change installation date" : "Change final payment date"} onClick={() => { setEdit(k); setVal(v); }}
      className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-[#1590D6] hover:bg-[#E8F6FE]"><Pencil className="h-3.5 w-3.5" /></button>);
  return (
    <div data-testid="balance-due-block" className={cn("rounded-2xl border border-[#BFE3F8] bg-[#F3FAFE] p-3 dark:bg-sky-500/10", className)}>
      {!compact && <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-[#1590D6]"><CalendarClock className="h-4 w-4" />Payment &amp; installation · {b.invoice_number}</div>}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className={cell}><div className={lab}>Installation</div>
          <div className="text-sm font-semibold">{b.job_done ? `Completed ${fmtDay(b.job_done)}` : b.install_at ? fmtDayTime(b.install_at) : "Not booked"}
            {b.can_edit_install && b.job_id && !b.job_done && editBtn("install", toLocalInput(b.install_at))}</div></div>
        <div className={cell}><div className={lab}>Deposit</div>
          <div className="text-sm font-semibold">{b.deposit_amount <= 0 ? "No deposit" : b.deposit_paid >= b.deposit_amount - 0.005 ? `${rand(b.deposit_paid)} paid ${fmtDay(b.deposit_paid_at)}` : b.deposit_paid > 0 ? `${rand(b.deposit_paid)} of ${rand(b.deposit_amount)} paid` : `${rand(b.deposit_amount)} · not paid`}</div></div>
        <div className={cell}><div className={lab}>Balance</div><div className="text-sm font-bold">{rand(b.balance)}</div></div>
        <div className={cell}><div className={lab}>Final payment</div>
          <div className={cn("text-sm font-semibold", TONE[final.tone])} data-testid="final-payment-line">{final.label}
            {b.can_edit_due && !closed && editBtn("due", b.due_manual && b.due ? b.due : "")}</div>
          {onRecordPayment && !closed && b.balance > 0.005 && (
            <button type="button" data-testid="final-tile-record-payment" onClick={onRecordPayment}
              className="mt-1.5 w-full rounded-xl bg-[#1AA7EC] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1590D6]">Record payment</button>)}
        </div>
      </div>
      {edit && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <input type={edit === "install" ? "datetime-local" : "date"} value={val} onChange={(e) => setVal(e.target.value)} aria-label="New date" className="rounded-lg border bg-white px-3 py-1.5" />
          <button disabled={busy || (edit === "install" && !val)} onClick={() => save()} className="rounded-xl bg-[#1AA7EC] px-3 py-1.5 font-semibold text-white">Save</button>
          {edit === "due" && b.due_manual && <button disabled={busy} onClick={() => save("")} className="rounded-xl border bg-white px-3 py-1.5">Back to on completion</button>}
          <button onClick={() => setEdit(null)} className="rounded-xl border bg-white px-3 py-1.5">Cancel</button>
          <span className="text-xs text-muted-foreground">Change is logged{edit === "due" ? ". Empty = due on completion" : ""}.</span>
        </div>)}
      {b.reminder_due && !closed && (
        <div data-testid="reminder-alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-[#F5C2C3] bg-[#FDECEC] px-3 py-2 text-sm text-[#8A1F23]">
          <AlertTriangle className="h-4 w-4" />Still unpaid {b.days ?? 2} days after completion.
          {b.is_admin && b.followup_id ? <button onClick={() => setPreview(true)} className="ml-auto rounded-xl bg-[#1AA7EC] px-3 py-1.5 font-semibold text-white">Preview reminder</button>
            : <span className="ml-auto text-xs">{b.followup_id ? "Admin to preview and send the reminder." : "Reminder draft appears with the next daily check."}</span>}
        </div>)}
      <PaymentReminderDialog followupId={b.followup_id} open={preview} onOpenChange={setPreview} onSent={refresh} />
    </div>
  );
}
export default BalanceDueBlock;

/** Job view: the balance invoice linked by invoice_id or by quote. */
export function BalanceDueBlockForJob({ job, className }: { job: { id: string; invoice_id?: string | null; quote_id?: string | null }; className?: string }) {
  const { data: invId } = useQuery({
    queryKey: ["job-balance-invoice", job.id, job.invoice_id, job.quote_id],
    queryFn: async () => {
      if (job.invoice_id) return job.invoice_id;
      if (!job.quote_id) return null;
      const { data } = await (supabase as any).from("invoices").select("id, status, deposit_amount").eq("quote_id", job.quote_id).not("status", "in", "(void,cancelled)").order("created_at", { ascending: false }).limit(1);
      return data?.[0]?.id ?? null;
    },
  });
  return invId ? <BalanceDueBlock invoiceId={invId} className={className} /> : null;
}
