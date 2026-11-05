import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { type BalanceInfo, finalPaymentLine, expectedFinal, installStage, fmtDay, fmtDayTime, rand, toLocalInput, fromLocalInput } from "@/lib/balanceDue";
import { PaymentReminderDialog } from "@/components/invoicing/PaymentReminderDialog";
import SendReminderDialog from "@/components/invoicing/SendReminderDialog";
import { useInvoiceHouseLabel } from "@/hooks/useInvoiceHouse";
import { shortDueLabel } from "@/lib/invoiceDue";

const TONE = { blue: "text-[#1590D6]", green: "text-emerald-600", amber: "text-[#B5730A]", red: "text-[#C9373C]" } as const;

export function useBalanceInfo(invoiceId?: string | null) {
  return useQuery({
    queryKey: ["invoice-balance", invoiceId], enabled: !!invoiceId,
    queryFn: async () => { const { data, error } = await (supabase as any).rpc("invoice_balance_info", { p_invoice: invoiceId }); if (error) throw error; return data as BalanceInfo | null; },
  });
}

/** Read-only extras the balance RPC does not return: the pencil's expected date (due_date_source) and the house step ticks. */
function useBalanceExtras(invoiceId?: string | null) {
  return useQuery({
    queryKey: ["invoice-balance-extras", invoiceId], enabled: !!invoiceId,
    queryFn: async () => {
      const { data } = await (supabase as any).from("invoices").select("due_date, due_date_source, expected_deposit_date, expected_final_date, project_house:project_houses(steps:project_house_steps(step_key, done))").eq("id", invoiceId).maybeSingle();
      return (data ?? null) as { due_date: string | null; due_date_source: string | null; expected_deposit_date?: string | null; expected_final_date?: string | null; project_house?: { steps?: { step_key: string; done: boolean }[] } | null } | null;
    },
  });
}

/** Installation · Deposit · Balance · Final payment, on every client view (Johan 31 Oct 09:56). Edits are logged server-side. */
export function BalanceDueBlock({ invoiceId, compact, className, onRecordPayment, ownerStrip }: { invoiceId: string; compact?: boolean; className?: string; onRecordPayment?: () => void; /** Bold orange owing strip on top (invoice detail, Johan 2 Nov 18:13). */ ownerStrip?: boolean }) {
  const qc = useQueryClient();
  const { data: b } = useBalanceInfo(invoiceId);
  const house = useInvoiceHouseLabel(invoiceId);
  const { data: extras } = useBalanceExtras(invoiceId);
  const [edit, setEdit] = useState<"install" | "due" | null>(null);
  const [val, setVal] = useState(""); const [busy, setBusy] = useState(false); const [preview, setPreview] = useState(false); const [remind, setRemind] = useState(false);
  if (!b) return null;
  const st = (b.status || "").toLowerCase();
  if (st === "draft" && !b.is_balance) return null;
  const refresh = () => { qc.invalidateQueries({ queryKey: ["invoice-balance"] }); qc.invalidateQueries({ queryKey: ["invoice-balance-extras"] }); qc.invalidateQueries({ queryKey: ["invoice-due"] }); qc.invalidateQueries({ queryKey: ["payment-followups"] }); };
  const final = finalPaymentLine(b);
  const expected = expectedFinal(b, extras);
  const stage = installStage(b, extras?.project_house?.steps);
  const stageWhen = stage?.key === "installed"
    ? (extras?.expected_final_date || expected || (!b.waiting && b.due) || null)
    : stage?.key === "due" ? (extras?.expected_deposit_date || null) : null;
  const stageText = stage ? (stageWhen ? `${stage.label} · expected ${fmtDay(stageWhen)}` : stage.label) : "";
  const canRemindBase = b.balance > 0.005 && !!(b.due || b.job_done);
  const closed = ["void", "cancelled", "paid"].includes(st) || b.balance <= 0.005;
  // Not chased before the job is done: balance is due on completion (Johan 2 Nov 17:49).
  const canRemind = !closed && canRemindBase;
  const overdue = !closed && !!b.due && b.due < new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
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
    <>
    {ownerStrip && !closed && (
      <div data-testid="invoice-owing-strip" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border-2 border-[#F97316] bg-[#FFF7ED] p-3 dark:bg-[#F97316]/10">
        <p className="min-w-0 text-lg font-bold leading-tight text-[#F97316] sm:text-xl">{rand(b.balance)} outstanding{overdue ? ` · ${rand(b.balance)} overdue` : b.due ? "" : expected ? ` · expected ${fmtDay(expected)}` : " · due on completion"}</p>
        <div className="flex gap-2">
          {onRecordPayment && <button type="button" data-testid="strip-add-payment" onClick={onRecordPayment} className="min-h-11 rounded-xl bg-[#F97316] px-4 text-sm font-semibold text-white hover:bg-[#EA580C]">+ Add payment</button>}
          {canRemind && <button type="button" data-testid="strip-send-reminder" onClick={() => setRemind(true)} className="min-h-11 rounded-xl border border-[#F97316] bg-white px-4 text-sm font-semibold text-[#C2410C] hover:bg-[#FFEDD5]">Send reminder</button>}
        </div>
      </div>)}
    <div data-testid="balance-due-block" data-stage={stage?.key} className={cn("rounded-2xl border border-[#BFE3F8] bg-[#F3FAFE] p-3 dark:bg-sky-500/10", stage && cn("border-l-4", stage.edge), className)}>
      {!compact && <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-[#1590D6]"><CalendarClock className="h-4 w-4" />{house && <><span data-testid="balance-house" className="font-bold text-foreground">{house}</span> · </>}Payment &amp; installation · {b.invoice_number}</div>}
      {stage && <div className="mb-2"><span data-testid="install-stage-tag" className={cn("inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold", stage.chip)}>{stageText}</span></div>}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className={cell}><div className={lab}>Installation</div>
          <div className="text-sm font-semibold">{b.job_done ? `Completed ${fmtDay(b.job_done)}` : b.install_at ? fmtDayTime(b.install_at) : "Not booked"}
            {b.can_edit_install && b.job_id && !b.job_done && editBtn("install", toLocalInput(b.install_at))}</div></div>
        <div className={cell}><div className={lab}>Deposit</div>
          <div className="text-sm font-semibold">{b.deposit_amount <= 0 ? "No deposit" : b.deposit_paid >= b.deposit_amount - 0.005 ? `${rand(b.deposit_paid)} paid ${fmtDay(b.deposit_paid_at)}` : b.deposit_paid > 0 ? `${rand(b.deposit_paid)} of ${rand(b.deposit_amount)} paid` : `${rand(b.deposit_amount)} · not paid`}</div></div>
        <div className={cell}><div className={lab}>Balance</div><div className="text-sm font-bold">{rand(b.balance)}</div>
          {/* Johan 2 Nov 18:13: actions live on the Balance tile. */}
          {onRecordPayment && !closed && b.balance > 0.005 && (
            <button type="button" data-testid="balance-add-payment" onClick={onRecordPayment}
              className="mt-1.5 min-h-11 w-full rounded-xl bg-[#F7941D] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#e08310]">+ Add payment</button>)}
          {canRemind && (
            <button type="button" data-testid="balance-send-reminder" onClick={() => setRemind(true)}
              className="mt-1.5 min-h-11 w-full rounded-xl border border-[#1AA7EC] bg-white px-3 py-1.5 text-xs font-semibold text-[#1590D6] hover:bg-[#E8F6FE]">Send reminder</button>)}
        </div>
        <div className={cell}><div className={lab}>Final payment</div>
          {expected
            ? <div data-testid="final-payment-line"><span className="text-sm font-bold text-[#1590D6]" data-testid="final-expected">Expected {fmtDay(expected)}</span>
                {b.can_edit_due && !closed && editBtn("due", expected)}
                <div className="text-xs text-muted-foreground">{shortDueLabel(final.label)}</div></div>
            : <div className={cn("text-sm font-semibold", TONE[final.tone])} data-testid="final-payment-line">{final.label}
            {b.can_edit_due && !closed && editBtn("due", b.due_manual && b.due ? b.due : "")}</div>}
        </div>
      </div>
      {edit && (
        <div data-testid="balance-edit-row" className="mt-2 space-y-2 rounded-xl border bg-white p-3 text-sm">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">{edit === "install" ? "New installation date and time" : "New final payment date"}</span>
            <input type={edit === "install" ? "datetime-local" : "date"} value={val} onChange={(e) => setVal(e.target.value)} aria-label="New date"
              className="block min-h-11 w-full appearance-none rounded-lg border bg-white px-3 py-2 text-base" />
            {!val && <span className="mt-1 block text-xs text-muted-foreground">{edit === "due" ? "No date set: due on completion. Tap above to pick one." : "Tap above to pick a date."}</span>}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy || (edit === "install" && !val)} onClick={() => save()} className="min-h-10 rounded-xl bg-[#1AA7EC] px-4 py-1.5 font-semibold text-white disabled:opacity-50">Save</button>
            <button onClick={() => setEdit(null)} className="min-h-10 rounded-xl border bg-white px-4 py-1.5">Cancel</button>
            {edit === "due" && b.due_manual && <button disabled={busy} onClick={() => save("")} className="min-h-10 rounded-xl border bg-white px-3 py-1.5">Back to on completion</button>}
            {edit === "due" && onRecordPayment && !closed && b.balance > 0.005 && <button type="button" data-testid="edit-row-add-payment" onClick={() => { setEdit(null); onRecordPayment(); }} className="ml-auto min-h-10 rounded-xl bg-[#F7941D] px-4 py-1.5 font-semibold text-white hover:bg-[#e08310]">+ Add payment</button>}
          </div>
          <p className="text-xs text-muted-foreground">Change is logged.</p>
        </div>)}
      {b.reminder_due && !closed && (
        <div data-testid="reminder-alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-[#F5C2C3] bg-[#FDECEC] px-3 py-2 text-sm text-[#8A1F23]">
          <AlertTriangle className="h-4 w-4" />Still unpaid {b.days ?? 2} days after completion.
          <span className="w-full text-xs sm:ml-auto sm:w-auto">Send a friendly reminder now.</span>
          <button type="button" data-testid="reminder-send-now" onClick={() => setRemind(true)} className="min-h-11 rounded-xl bg-[#1AA7EC] px-3 py-1.5 font-semibold text-white">Send reminder now</button>
        </div>)}
      <SendReminderDialog open={remind} onOpenChange={setRemind} initialId={b.invoice_id} invoices={[{ id: b.invoice_id, invoice_number: b.invoice_number, grand_total: Number(b.total) || 0, amount_due: b.balance }]} onDone={refresh} />
      <PaymentReminderDialog followupId={b.followup_id} open={preview} onOpenChange={setPreview} onSent={refresh} />
    </div>
    </>
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
