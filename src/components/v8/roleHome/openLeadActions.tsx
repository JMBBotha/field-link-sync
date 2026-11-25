import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/useRole";
import { useSalesRep } from "@/hooks/useSalesRep";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MarkSentManuallyButton } from "@/components/documents/MarkSentManually";
import { useQuoteDeleteArchive } from "@/components/quoting/QuoteDeleteArchive";
import SendQuoteDialog from "@/components/quoting/SendQuoteDialog";
import { canArchiveOpenLead, OPEN_LEAD_STALE_DAYS } from "@/lib/openLeads";
import { bulkSendLine, type BulkSendLine } from "@/lib/openLeadBulk";
import { reasonOk } from "@/lib/quoteDeleteArchive";
import { assertQuotePriced } from "@/lib/quoteSend";
import { assertQuoteUnitImages } from "@/lib/findProductImage";
import { publicQuoteUrl } from "@/lib/publicAppUrl";
import { clearLocalSendLock, readSendReply, setLocalSendLock, type SendReply } from "@/lib/quoteEmailSend";
import type { OpenLeadRow } from "@/lib/yardView";
import type { OpenLeadActions } from "./OpenLeadsCard";

const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args);

function archiveError(error: { message?: string } | null | undefined, fallback: string): string {
  const message = error?.message || fallback;
  if (/lead_archive|lead_unarchive|column ["']?archived_at/i.test(message)) {
    return "Lead archive is not on the database yet. The migration is written and has not been applied. Quotes can still be archived.";
  }
  return message;
}

function sendDetail(reply: SendReply): { ok: boolean; detail: string } {
  if (reply.kind === "ok") return { ok: true, detail: "Sent" };
  if (reply.kind === "recent") return { ok: false, detail: `Already sent to ${reply.sentTo}` };
  if (reply.kind === "in_progress") return { ok: false, detail: "Already sending" };
  if (reply.kind === "not_configured") return { ok: false, detail: "Email is not configured" };
  if (reply.kind === "unknown") return { ok: false, detail: reply.reason };
  return { ok: false, detail: reply.reason };
}

async function undoRows(rows: OpenLeadRow[]) {
  for (const row of rows) {
    if (row.kind === "quote" && row.quoteId) await rpc("quote_unarchive", { p_quote: row.quoteId });
    else if (row.kind === "lead" && row.leadId) await rpc("lead_unarchive", { p_lead: row.leadId });
  }
}

/** Live send, mark-as-sent, and archive for the Open leads card. Send opens the existing dialog and does not send by itself. */
export function useOpenLeadActions(): { actions: OpenLeadActions; dialogs: ReactNode } {
  const { isAdmin, userId } = useRole();
  const { isSalesRep } = useSalesRep();
  const archive = useQuoteDeleteArchive();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [send, setSend] = useState<OpenLeadRow | null>(null);
  const [mark, setMark] = useState<OpenLeadRow | null>(null);
  const [lead, setLead] = useState<OpenLeadRow | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["yard-sales"] });
    qc.invalidateQueries({ queryKey: ["quotes"] });
    qc.invalidateQueries({ queryKey: ["leads"] });
  };

  const archiveOne = async (row: OpenLeadRow, why: string) => {
    if (row.kind === "quote" && row.quoteId) return rpc("quote_archive", { p_quote: row.quoteId, p_reason: why });
    if (row.kind === "lead" && row.leadId) return rpc("lead_archive", { p_lead: row.leadId, p_reason: why });
    return { error: { message: "Nothing to archive" } };
  };

  const onArchiveStale = async (rows: OpenLeadRow[]) => {
    const why = `No activity for ${OPEN_LEAD_STALE_DAYS} days`;
    const done: OpenLeadRow[] = [];
    const failed: string[] = [];
    for (const row of rows) {
      const { error } = await archiveOne(row, why);
      if (error) failed.push(`${row.quoteRef || row.customer}: ${archiveError(error, "Could not archive")}`);
      else done.push(row);
    }
    refresh();
    toast({
      title: done.length ? `${done.length} archived` : "Could not archive",
      description: failed.length ? `Still on the list: ${failed.join(", ")}` : "Hidden from Open leads. Invoices and payments are kept.",
      variant: done.length ? "default" : "destructive",
      action: done.length ? (
        <ToastAction altText="Undo archive" onClick={() => { void undoRows(done).then(refresh); }}>Undo</ToastAction>
      ) : undefined,
    });
  };

  const saveLead = async () => {
    if (!lead) return;
    setBusy(true);
    const { error } = await archiveOne(lead, reason.trim());
    setBusy(false);
    if (error) {
      toast({ title: "Could not archive", description: archiveError(error, "Could not archive"), variant: "destructive" });
      return;
    }
    const archived = lead;
    setLead(null);
    setReason("");
    refresh();
    toast({
      title: `${archived.customer} archived`,
      description: "Hidden from Open leads. You can restore it from Archived leads.",
      action: <ToastAction altText="Undo archive" onClick={() => { void undoRows([archived]).then(refresh); }}>Undo</ToastAction>,
    });
  };

  const actions: OpenLeadActions = {
    canArchive: (row) => canArchiveOpenLead(row, { isAdmin, isSalesRep, userId }),
    onSend: (row) => { if (row.quoteId) setSend(row); },
    onMarkSent: (row) => { if (row.quoteId) setMark(row); },
    onArchive: (row) => {
      if (row.kind === "quote" && row.quoteId) {
        archive.startArchive({ id: row.quoteId, quote_number: row.quoteRef, archived_at: null });
        return;
      }
      setReason("");
      setLead(row);
    },
    onArchiveStale,
    onBulkMarkSent: async (drafts, ch) => {
      const failed: string[] = [];
      for (const row of drafts) {
        const { error } = await rpc("mark_document_sent", { p_kind: "quote", p_id: row.quoteId, p_channel: ch, p_note: null });
        if (error) failed.push(row.quoteRef || row.customer);
      }
      refresh();
      toast({
        title: failed.length ? "Some drafts were not marked" : `${drafts.length} marked as sent`,
        description: failed.length ? failed.join(", ") : "Nothing was emailed.",
        variant: failed.length ? "destructive" : "default",
      });
    },
    onBulkArchive: async (list, why) => {
      const done: OpenLeadRow[] = [];
      const failed: string[] = [];
      for (const row of list) {
        const { error } = await archiveOne(row, why);
        if (error) failed.push(`${row.quoteRef || row.customer}: ${archiveError(error, "Could not archive")}`);
        else done.push(row);
      }
      refresh();
      toast({
        title: done.length ? `${done.length} archived` : "Could not archive",
        description: failed.length ? failed.join(", ") : "Hidden from Open leads. Invoices and payments are kept.",
        variant: done.length ? "default" : "destructive",
        action: done.length ? <ToastAction altText="Undo archive" onClick={() => { void undoRows(done).then(refresh); }}>Undo</ToastAction> : undefined,
      });
    },
    prepareBulkSend: async (list) => {
      const customerIds = [...new Set(list.map((row) => row.customerId).filter((id): id is string => !!id))];
      const { data } = customerIds.length
        ? await supabase.from("customers").select("id, email, phone").in("id", customerIds)
        : { data: [] as { id: string; email: string | null; phone: string | null }[] };
      const byId = new Map((data || []).map((row) => [row.id, row]));
      return list.map((row) => bulkSendLine(row, row.customerId ? byId.get(row.customerId) : undefined));
    },
    confirmBulkSend: async (lines: BulkSendLine[]) => {
      const out: { customer: string; ok: boolean; detail: string }[] = [];
      for (const line of lines) {
        if (!line.quoteId || !line.email) { out.push({ customer: line.customer, ok: false, detail: line.block || "No email" }); continue; }
        const sendId = crypto.randomUUID();
        setLocalSendLock(line.quoteId, sendId);
        try {
          await assertQuotePriced(line.quoteId);
          await assertQuoteUnitImages(line.quoteId);
          const { data: quote } = await supabase.from("quotes").select("public_token, quote_number, total").eq("id", line.quoteId).maybeSingle();
          const { data, error } = await supabase.functions.invoke("send-quote-email", {
            body: {
              to: line.email,
              subject: `Your quote ${line.quoteRef || quote?.quote_number || ""}`.trim(),
              quoteNumber: line.quoteRef || quote?.quote_number,
              clientName: line.customer,
              totalAmount: quote?.total ?? undefined,
              unsubscribeToken: crypto.randomUUID(),
              quoteId: line.quoteId,
              customerId: line.customerId,
              quoteUrl: quote?.public_token ? publicQuoteUrl(quote.public_token) : null,
              sendId,
            },
          });
          const reply = await readSendReply(data, error);
          const detail = sendDetail(reply);
          out.push({ customer: line.customer, ok: detail.ok, detail: detail.detail });
        } catch (err) {
          out.push({ customer: line.customer, ok: false, detail: err instanceof Error ? err.message : "Not sent" });
        } finally {
          clearLocalSendLock(line.quoteId, sendId);
        }
      }
      refresh();
      return out;
    },
  };

  const dialogs = (
    <>
      {archive.dialogs}
      {send?.quoteId && (
        <SendQuoteDialog
          open
          onOpenChange={(next) => { if (!next) { setSend(null); refresh(); } }}
          quoteId={send.quoteId}
          quoteNumber={send.quoteRef || "Draft"}
          customerId={send.customerId}
          customerName={send.customer}
        />
      )}
      {mark?.quoteId && (
        <MarkSentManuallyButton
          anyRole
          hideTrigger
          forceOpen
          kind="quote"
          id={mark.quoteId}
          status="draft"
          onDone={refresh}
          onForceClose={() => setMark(null)}
        />
      )}
      <Dialog open={!!lead} onOpenChange={(next) => { if (!next && !busy) setLead(null); }}>
        <DialogContent className="sm:max-w-md" data-testid="lead-archive-dialog">
          <DialogHeader>
            <DialogTitle>Archive {lead?.customer || "this lead"}?</DialogTitle>
            <DialogDescription>
              It leaves Open leads. Nothing is deleted, and no message is sent. An admin can restore it from Archived leads.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1 text-sm">
            <Label htmlFor="lead-archive-reason">Reason</Label>
            <Textarea id="lead-archive-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. No reply, park it" />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setLead(null)}>Cancel</Button>
            <Button className="bg-[#C2410C] text-white hover:bg-[#9a3412]" disabled={!reasonOk(reason) || busy} onClick={() => void saveLead()}>Archive</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  return { actions, dialogs };
}
