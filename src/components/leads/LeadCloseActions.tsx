import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useIsMainCompany } from "@/hooks/useIsMainCompany";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { closedLabel, DISMISS_EXAMPLES, LOST_LABEL, LOST_REASONS, NOT_REAL_JOB_LABEL, NOT_REAL_JOB_REASONS, type CloseOutcome } from "@/lib/leadClose";

const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args);

/** Dismiss (main company admin/sales) · Close lead (any company admin/sales) · Restore (admin). Server enforces all rules. */
export const V8_PRIMARY = "bg-[#1590D6] text-white hover:bg-[#127FBF] font-semibold";
export const V8_OUTLINE = "border-[#D6E4EF] bg-white text-[#0F2A44] hover:bg-[#EEF6FC] hover:text-[#0F2A44]";

export default function LeadCloseActions({ lead, compact, onDone, closeOnly, closeLabel }: { lead: any; compact?: boolean; onDone?: () => void; closeOnly?: boolean; closeLabel?: string }) {
  const { isMain } = useIsMainCompany();
  const qc = useQueryClient();
  const canQ = useQuery({
    queryKey: ["lead-can-close", lead?.id], enabled: !!lead?.id, staleTime: 60_000,
    queryFn: async () => (await rpc("can_close_lead", { p_lead: lead.id })).data === true,
  });
  const staff = canQ.data === true;
  const [mode, setMode] = useState<null | "dismiss" | "close">(null);
  const [outcome, setOutcome] = useState<CloseOutcome>("not_real_job");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const closed = closedLabel(lead);
  const lostQ = useQuery({
    queryKey: ["lead-lost-allowed", lead?.id],
    enabled: mode === "close" && !!lead?.id,
    queryFn: async () => (await rpc("lead_lost_allowed", { p_lead: lead.id })).data === true,
  });
  const lostOk = lostQ.data === true;
  if (!lead?.id || !staff) return null;

  const refresh = () => {
    ["lead-inbox", "sales-heartbeat", "leads", "lead", "lead-quote-followups"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    onDone?.();
  };
  const open = (m: "dismiss" | "close") => { setMode(m); setOutcome("not_real_job"); setReason(""); setNote(""); };
  const submit = async () => {
    const r = mode === "dismiss" && DISMISS_EXAMPLES.includes(reason) && note.trim() ? `${reason} – ${note.trim()}` : reason;
    setBusy(true);
    const { error } = mode === "dismiss"
      ? await rpc("dismiss_lead", { p_lead: lead.id, p_reason: r })
      : await rpc("close_lead", { p_lead: lead.id, p_outcome: outcome, p_reason: r, p_note: note || null });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(mode === "dismiss" ? "Lead dismissed" : outcome === "lost" ? "Lead closed · logged for learning" : "Lead closed · kept for follow-up");
    setMode(null); refresh();
  };
  const restore = async () => {
    const { error } = await rpc("restore_lead", { p_lead: lead.id });
    if (error) { toast.error(error.message); return; }
    toast.success("Lead reopened"); refresh();
  };

  if (closed) {
    if (closeOnly) return null;
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-secondary" data-testid="lead-closed-state">
        <span className="rounded-full bg-[#EEF2F6] px-2.5 py-1 text-xs font-semibold text-[#4A5D70]">{closed}</span>
        <span className="min-w-0 break-words">{lead.dismiss_reason || lead.close_reason}{lead.close_note ? ` · ${lead.close_note}` : ""}</span>
        {!closeOnly && <Button size="sm" variant="outline" className={V8_OUTLINE} onClick={restore} data-testid="lead-restore">Reopen lead</Button>}
      </div>
    );
  }

  const reasons = mode === "dismiss" ? DISMISS_EXAMPLES : outcome === "lost" ? LOST_REASONS : NOT_REAL_JOB_REASONS;
  const pill = (active: boolean) => cn("rounded-full border px-3 py-1.5 text-sm", active ? "border-[#1590D6] bg-[#EEF6FC] text-[#0F6FA8] font-semibold" : "border-[#D6E4EF] bg-white text-[#4A5D70] hover:bg-[#F5F9FC]");

  return (
    <>
      <div className={cn("flex flex-wrap gap-2", compact && "gap-1.5")} data-testid="lead-close-actions">
        {isMain && !closeOnly && <Button size={compact ? "sm" : "default"} variant="outline" className={V8_OUTLINE} onClick={() => open("dismiss")} data-testid="lead-dismiss">Dismiss</Button>}
        <Button size={compact ? "sm" : "default"} variant="outline" className={V8_OUTLINE} onClick={() => open("close")} data-testid="lead-close">{closeLabel ?? "Close lead"}</Button>
      </div>
      <Dialog open={!!mode} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[#0F2A44]">{mode === "dismiss" ? "Dismiss lead" : "Close lead"}</DialogTitle>
            <DialogDescription>
              {mode === "dismiss" ? "Not a real lead (test, accidental call). It leaves the inbox and reminders, is never counted as lost, and can be restored by an admin."
                : "It leaves the inbox and reminders. Lost is company learning only and is never counted against a person."}
            </DialogDescription>
          </DialogHeader>
          {mode === "close" && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap gap-2">
                <button type="button" className={pill(outcome === "not_real_job")} onClick={() => { setOutcome("not_real_job"); setReason(""); }} data-testid="close-outcome-nrj">{NOT_REAL_JOB_LABEL}</button>
                <button type="button" disabled={!lostOk} className={cn(pill(outcome === "lost"), !lostOk && "opacity-40")} onClick={() => { setOutcome("lost"); setReason(""); }} data-testid="close-outcome-lost">{LOST_LABEL}</button>
              </div>
              {!lostOk && <p className="text-xs text-[#6B7C8F]">Lost is only for leads where we visited the client and sent a proper quote. Online/remote quotes and enquiries stay as follow-up contacts.</p>}
              {outcome === "not_real_job" && <p className="text-xs text-[#6B7C8F]">The client stays on the follow-up list for marketing.</p>}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {reasons.map((r) => <button key={r} type="button" className={pill(reason === r)} onClick={() => setReason(r)}>{r}</button>)}
          </div>
          <Textarea
            placeholder={mode === "dismiss" ? "Reason (required), e.g. test call / phoned by accident" : "Note (optional)"}
            value={mode === "dismiss" ? (DISMISS_EXAMPLES.includes(reason) ? note : reason) : note}
            onChange={(e) => (mode === "dismiss" && !DISMISS_EXAMPLES.includes(reason) ? setReason(e.target.value) : setNote(e.target.value))}
            data-testid="lead-close-note"
          />
          <DialogFooter>
            <Button variant="ghost" className="text-[#4A5D70]" onClick={() => setMode(null)}>Cancel</Button>
            <Button className={V8_PRIMARY} disabled={busy || reason.trim().length < 2 || (outcome === "lost" && mode === "close" && !lostOk)}
              onClick={submit}
              data-testid="lead-close-confirm">{mode === "dismiss" ? "Dismiss" : "Close lead"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
