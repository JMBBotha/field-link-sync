import { useState } from "react";
import { CheckCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useRole } from "@/hooks/useRole";
import { cn } from "@/lib/utils";

/** Mark as sent (without emailing), Johan 2026-10-13 13:45. Shared by quotes and invoices in every company.
 *  Permission, status change, audit log and the owner notification all happen server-side in mark_document_sent. */
export const SENT_CHANNELS = [
  { k: "whatsapp", label: "WhatsApp" },
  { k: "handed_over", label: "Handed over" },
  { k: "other", label: "Other" },
] as const;
export const channelLabel = (c?: string | null) => SENT_CHANNELS.find((x) => x.k === c)?.label ?? "Other";

export function SentManuallyBadge({ doc, className }: { doc: { sent_method?: string | null; sent_channel?: string | null; status?: string | null }; className?: string }) {
  if (doc?.sent_method !== "manual") return null;
  return (
    <span data-testid="sent-manually-badge" title="Marked as sent without emailing"
      className={cn("inline-flex items-center gap-1 rounded-full border border-[#1AA7EC]/40 bg-[#1AA7EC]/10 px-2 py-0.5 text-[10.5px] font-semibold text-[#0b5e8a] dark:text-[#7cc8f0] whitespace-nowrap", className)}>
      <CheckCheck className="h-3 w-3" />Sent manually · {channelLabel(doc.sent_channel)}
    </span>
  );
}

export function MarkSentManuallyButton({ kind, id, status, onDone, size = "sm", className }: {
  kind: "quote" | "invoice"; id: string; status?: string | null; onDone?: () => void; size?: "sm" | "default"; className?: string;
}) {
  const { isAdmin, isDispatcher } = useRole();
  const [open, setOpen] = useState(false);
  const [ch, setCh] = useState<string>("whatsapp");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // Techs/viewers never see it; reps are limited to their own docs by the server.
  if (status !== "draft" || !(isAdmin || isDispatcher)) return null;
  const save = async () => {
    setBusy(true);
    const { error } = await (supabase.rpc as any)("mark_document_sent", { p_kind: kind, p_id: id, p_channel: ch, p_note: note || null });
    setBusy(false);
    if (error) { toast.error(error.message || "Could not mark as sent"); return; }
    toast.success(`${kind === "quote" ? "Quote" : "Invoice"} marked as sent · ${channelLabel(ch)}`);
    setOpen(false); setNote(""); onDone?.();
  };
  return (
    <>
      <Button variant="outline" size={size} className={className} onClick={() => setOpen(true)} data-testid="mark-sent-manual">
        <CheckCheck className="mr-2 h-4 w-4" />Mark as sent
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Mark as sent (no email)</DialogTitle>
            <DialogDescription>Use this when the client already has the {kind} another way. Nothing is emailed.{kind === "quote" ? " The client link can then be accepted." : " It then counts as outstanding."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm font-medium">How was it sent?</div>
            <div className="grid grid-cols-3 gap-2">
              {SENT_CHANNELS.map((c) => (
                <Button key={c.k} type="button" variant={ch === c.k ? "default" : "outline"} size="sm" onClick={() => setCh(c.k)}>{c.label}</Button>
              ))}
            </div>
            <Textarea placeholder="Note (optional), e.g. sent to Josh on WhatsApp" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Mark as sent</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
