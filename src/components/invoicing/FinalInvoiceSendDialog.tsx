import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, MessageCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { finalSentLabel, finalInvoiceWhatsAppUrl } from "@/lib/invoiceMoney";

/**
 * Send final invoice (Johan 30 Oct 19:48: "pressed twice but no conf").
 * WhatsApp opens from a real link tap (no await before it, so iPhone does not block it),
 * then the user confirms "I sent it" → server stamps final_sent_at, logs + notifies, and
 * refuses a second stamp within 10 minutes (double-press guard).
 */
export default function FinalInvoiceSendDialog({ invoice, balance, autoOpen, onDone }: {
  invoice: { id: string; invoice_number?: string | null; customer_name?: string | null; customer_phone?: string | null; due_date?: string | null; pdf_url?: string | null; final_sent_at?: string | null; final_sent_channel?: string | null };
  balance: number; autoOpen?: boolean; onDone?: () => void;
}) {
  const [open, setOpen] = useState(!!autoOpen);
  const [step, setStep] = useState<"choose" | "confirm">("choose");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => { if (autoOpen) setOpen(true); }, [autoOpen]);
  const wa = finalInvoiceWhatsAppUrl(invoice, balance);
  const sentLabel = finalSentLabel(invoice);

  const log = async (stage: "opened" | "confirmed", channel = "whatsapp") =>
    (supabase.rpc as any)("log_final_invoice_send", { p_id: invoice.id, p_channel: channel, p_stage: stage });

  const confirm = async (channel: string) => {
    if (lock.current) return; lock.current = true; setBusy(true);
    const { data, error } = await log("confirmed", channel);
    setBusy(false); lock.current = false;
    if (error) { toast.error(error.message || "Could not record the send"); return; }
    if (data?.duplicate) toast.message("Already recorded as sent a moment ago, nothing changed.");
    else toast.success(`Final invoice ${invoice.invoice_number || ""} recorded as sent · ${channel === "whatsapp" ? "WhatsApp" : "Other"}`);
    setOpen(false); setStep("choose"); onDone?.();
  };

  return (
    <>
      <Button data-testid="send-final-invoice" onClick={() => { setStep("choose"); setOpen(true); }}
        className="w-full h-12 rounded-xl text-base font-semibold bg-orange-500 hover:bg-orange-600 text-white">
        <Send className="h-4 w-4 mr-2" /> {sentLabel ? "Send final invoice again" : "Send final invoice"} · R {Math.round(balance).toLocaleString("en-ZA").replace(/,/g, " ")}
      </Button>
      {sentLabel && <p data-testid="final-sent-label" className="flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" />{sentLabel}</p>}
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setStep("choose"); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{step === "choose" ? "Send final invoice" : "Did it send?"}</DialogTitle>
            <DialogDescription>
              {step === "choose"
                ? `${invoice.invoice_number || "Invoice"} · balance R ${balance.toFixed(2)} to ${invoice.customer_name || "the client"}.`
                : `WhatsApp opened to ${invoice.customer_name || "the client"}. Only confirm once you pressed Send in WhatsApp. Nothing is sent by the app itself.`}
            </DialogDescription>
          </DialogHeader>
          {sentLabel && step === "choose" && <p className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">{sentLabel}. Sending again will message the client a second time.</p>}
          {step === "choose" ? (
            <div className="space-y-2">
              {wa ? (
                <a href={wa} target="_blank" rel="noopener noreferrer" data-testid="final-open-whatsapp"
                  onClick={() => { void log("opened"); setStep("confirm"); }}
                  className="flex h-12 w-full items-center justify-center rounded-xl bg-orange-500 text-base font-semibold text-white hover:bg-orange-600">
                  <MessageCircle className="mr-2 h-5 w-5" /> Open WhatsApp to {invoice.customer_name || "client"}
                </a>
              ) : (
                <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">No phone number on this invoice. Add one to the client, or send it another way and record it below.</p>
              )}
              <Button variant="outline" className="h-11 w-full rounded-xl" disabled={busy} onClick={() => confirm("other")}>
                I sent it another way, record it
              </Button>
            </div>
          ) : (
            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="ghost" onClick={() => { setOpen(false); setStep("choose"); toast.message("Not recorded. Nothing was sent by the app."); }}>Not sent</Button>
              <Button data-testid="final-confirm-sent" disabled={busy} className="bg-orange-500 hover:bg-orange-600 text-white" onClick={() => confirm("whatsapp")}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Yes, I sent it
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
