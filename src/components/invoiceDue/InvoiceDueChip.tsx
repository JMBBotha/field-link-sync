import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { dueChip, STEP_LABEL, randShort, type DueRow } from "@/lib/invoiceDue";

const TONE: Record<string, string> = {
  blue: "bg-[#E8F6FE] text-[#1590D6]", amber: "bg-[#FFF4E0] text-[#B5730A]", orange: "bg-[#FFEBDD] text-[#C2570C]", red: "bg-[#FDECEC] text-[#C9373C]",
};

/** Soft due chip for an invoice row. Pressing it opens the inline review (when there is a draft). */
export function InvoiceDueChip({ row, onClick, className }: { row: DueRow; onClick?: () => void; className?: string }) {
  const c = dueChip(row);
  return (
    <button type="button" data-testid="invoice-due-chip" onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", TONE[c.tone], className)}>
      {c.label}{row.followup_status === "pending" ? " · review" : row.followup_status === "approved" ? " · ready to send" : ""}
    </button>
  );
}

/** Inline Review / Edit / Approve for a client reminder. Never auto-sent: owner edits, approves, then sends once by email. */
export function FollowupReview({ row, onDone }: { row: DueRow; onDone?: () => void }) {
  const qc = useQueryClient();
  const { data: owner } = useQuery({ queryKey: ["is-my-company-owner"], queryFn: async () => (await (supabase as any).rpc("is_my_company_owner")).data === true });
  const [subject, setSubject] = useState(row.followup_subject || `Invoice ${row.invoice_number || ""}`);
  const [body, setBody] = useState(row.followup_message || "");
  const [busy, setBusy] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["invoice-due"] }); qc.invalidateQueries({ queryKey: ["payment-followups"] }); onDone?.(); };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  if (row.step === "plus14" && !row.followup_id) return (
    <div onClick={stop} className="mt-2 rounded-xl border border-[#F5C2C3] bg-[#FDECEC] p-3 text-sm text-[#8A1F23]">
      {row.days} days late · {randShort(row.amount_due)}. Owner to phone {row.customer_name || "the client"} personally. No more reminder emails are drafted.
    </div>);
  if (!row.followup_id) return (
    <div onClick={stop} className="mt-2 rounded-xl border bg-[#F3FAFE] p-3 text-sm text-muted-foreground">No reminder waiting. The next friendly draft appears at the next step.</div>);
  const decide = async (approve: boolean) => {
    setBusy(true);
    const { error } = await (supabase as any).rpc("pf_decide", { p_id: row.followup_id, p_approve: approve, p_message: body, p_subject: subject });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(approve ? "Approved. Press Send email to send it once." : "Declined. Nothing will be sent.");
    refresh();
  };
  const send = async () => {
    if (!window.confirm(`Send this email to ${row.customer_name || "the client"}${row.customer_email ? ` (${row.customer_email})` : ""} now? It sends once.`)) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("send-reminder-email", { body: { followup_id: row.followup_id } });
    setBusy(false);
    if (error || !data?.success) return toast.error((data as any)?.error || error?.message || "Not sent");
    toast.success(`Reminder emailed to ${data.sentTo}`); refresh();
  };
  const pending = row.followup_status === "pending";
  return (
    <div onClick={stop} className="mt-2 space-y-2 rounded-xl border border-[#BFE3F8] bg-[#F3FAFE] p-3 text-sm" data-testid="followup-review">
      <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-[#1590D6]"><Mail className="h-4 w-4" />
        Client reminder · {STEP_LABEL[row.followup_step || ""] || "reminder"} · email to {row.customer_email || "no email on invoice"}</div>
      {pending ? (<>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!owner} aria-label="Subject" className="w-full rounded-lg border bg-white px-3 py-2" />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} disabled={!owner} aria-label="Message" rows={6} className="w-full rounded-lg border bg-white px-3 py-2" />
        {owner ? (
          <div className="flex flex-wrap gap-2">
            <button disabled={busy} onClick={() => decide(true)} className="rounded-xl bg-[#1AA7EC] px-4 py-2 font-semibold text-white">Approve</button>
            <button disabled={busy} onClick={() => decide(false)} className="rounded-xl border bg-white px-4 py-2">Decline</button>
          </div>) : <div className="text-muted-foreground">Waiting for the owner to edit and approve.</div>}
      </>) : (<>
        <div className="font-semibold">{row.followup_subject}</div>
        <div className="whitespace-pre-wrap text-muted-foreground">{row.followup_message}</div>
        <button disabled={busy} onClick={send} className="rounded-xl bg-[#1AA7EC] px-4 py-2 font-semibold text-white">Send email (once)</button>
      </>)}
    </div>
  );
}
