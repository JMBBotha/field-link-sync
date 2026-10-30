import { useEffect, useRef, useState } from "react";
import { renderBrandedEmail, finalInvoiceBodyHtml, brandedTransactionalFooter } from "@/lib/brandedEmail";
import { CheckCircle2, Loader2, Mail, MessageCircle, Send } from "lucide-react";
import { Input } from "@/components/ui/input";
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
 * Email (Johan 30 Oct 20:29, the default): preview the email, press Send → server emails via
 * send-transactional-email (0800becool.co.za), logs who/when/where and shows "Emailed to … at …".
 */
export default function FinalInvoiceSendDialog({ invoice, balance, autoOpen, onDone }: {
  invoice: { id: string; invoice_number?: string | null; customer_name?: string | null; customer_phone?: string | null; customer_email?: string | null; due_date?: string | null; pdf_url?: string | null; final_sent_at?: string | null; final_sent_channel?: string | null };
  balance: number; autoOpen?: boolean; onDone?: () => void;
}) {
  const [open, setOpen] = useState(!!autoOpen);
  const [step, setStep] = useState<"choose" | "preview" | "emailed" | "confirm">("choose");
  const [busy, setBusy] = useState(false);
  const [to, setTo] = useState(invoice.customer_email || "");
  const [preview, setPreview] = useState<{ to: string; subject: string; html: string } | null>(null);
  const [emailed, setEmailed] = useState<{ to: string; at: string; duplicate?: boolean } | null>(null);
  const lock = useRef(false);
  useEffect(() => { if (autoOpen) setOpen(true); }, [autoOpen]);
  useEffect(() => { setTo(invoice.customer_email || ""); }, [invoice.customer_email]);
  const wa = finalInvoiceWhatsAppUrl(invoice, balance);
  const sentLabel = finalSentLabel(invoice);
  const reset = () => { setStep("choose"); setPreview(null); setEmailed(null); };

  const log = async (stage: "opened" | "confirmed", channel = "whatsapp") =>
    (supabase.rpc as any)("log_final_invoice_send", { p_id: invoice.id, p_channel: channel, p_stage: stage });

  const confirm = async (channel: string) => {
    if (lock.current) return; lock.current = true; setBusy(true);
    const { data, error } = await log("confirmed", channel);
    setBusy(false); lock.current = false;
    if (error) { toast.error(error.message || "Could not record the send"); return; }
    if (data?.duplicate) toast.message("Already recorded as sent a moment ago, nothing changed.");
    else toast.success(`Final invoice ${invoice.invoice_number || ""} recorded as sent · ${channel === "whatsapp" ? "WhatsApp" : "Other"}`);
    setOpen(false); reset(); onDone?.();
  };

  const loadPreview = async () => {
    if (lock.current) return; lock.current = true; setBusy(true);
    const { data, error } = await (supabase.rpc as any)("send_final_invoice_email", { p_invoice: invoice.id, p_to: to.trim() || null, p_mode: "preview" });
    setBusy(false); lock.current = false;
    if (error) { toast.error(error.message || "Could not build the email"); return; }
    const lay = data.layout;
    const html = lay?.template === "final_invoice" && lay.brand && lay.data
      ? renderBrandedEmail({ brand: lay.brand, title: lay.title || data.subject, kicker: lay.kicker || "", greetingName: lay.greeting_name, bodyHtml: finalInvoiceBodyHtml(lay.data), footerHtml: brandedTransactionalFooter(lay.brand.name || "") })
      : data.html;
    setPreview({ to: data.to, subject: data.subject, html }); setStep("preview");
  };

  const sendEmail = async () => {
    if (lock.current || !preview) return; lock.current = true; setBusy(true);
    const { data, error } = await (supabase.rpc as any)("send_final_invoice_email", { p_invoice: invoice.id, p_to: preview.to, p_mode: "send" });
    setBusy(false); lock.current = false;
    if (error) { toast.error(error.message || "Email not sent"); return; }
    setEmailed({ to: data.to || preview.to, at: data.final_sent_at || new Date().toISOString(), duplicate: !!data.duplicate });
    setStep("emailed"); onDone?.();
  };

  const at = (iso: string) => new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const title = { choose: "Send final invoice", preview: "Check the email", emailed: "Email sent", confirm: "Did it send?" }[step];

  return (
    <>
      <Button data-testid="send-final-invoice" onClick={() => { reset(); setOpen(true); }}
        className="w-full h-12 rounded-xl text-base font-semibold bg-orange-500 hover:bg-orange-600 text-white">
        <Send className="h-4 w-4 mr-2" /> {sentLabel ? "Send final invoice again" : "Send final invoice"} · R {Math.round(balance).toLocaleString("en-ZA").replace(/,/g, " ")}
      </Button>
      {sentLabel && <p data-testid="final-sent-label" className="flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" />{sentLabel}</p>}
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent className="max-w-sm max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {step === "choose" && `${invoice.invoice_number || "Invoice"} · balance R ${balance.toFixed(2)} to ${invoice.customer_name || "the client"}.`}
              {step === "preview" && "This is exactly what the client gets. Nothing is sent until you press Send."}
              {step === "emailed" && "The client has been emailed and it is logged on the invoice."}
              {step === "confirm" && `WhatsApp opened to ${invoice.customer_name || "the client"}. Only confirm once you pressed Send in WhatsApp. Nothing is sent by the app itself.`}
            </DialogDescription>
          </DialogHeader>
          {sentLabel && step === "choose" && <p className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">{sentLabel}. Sending again will reach the client a second time.</p>}
          {step === "choose" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label htmlFor="final-email-to" className="text-sm font-medium">Email to</label>
                <Input id="final-email-to" data-testid="final-email-to" type="email" inputMode="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@example.com" className="h-11" />
              </div>
              <Button data-testid="final-email-preview" disabled={busy || !to.trim()} onClick={loadPreview} className="h-12 w-full rounded-xl bg-orange-500 text-base font-semibold text-white hover:bg-orange-600">
                {busy ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Mail className="mr-2 h-5 w-5" />} Preview email
              </Button>
              <p className="pt-1 text-center text-xs text-muted-foreground">or</p>
              {wa ? (
                <a href={wa} target="_blank" rel="noopener noreferrer" data-testid="final-open-whatsapp"
                  onClick={() => { void log("opened"); setStep("confirm"); }}
                  className="flex h-11 w-full items-center justify-center rounded-xl border text-sm font-medium hover:bg-accent">
                  <MessageCircle className="mr-2 h-4 w-4" /> Send by WhatsApp instead
                </a>
              ) : null}
              <Button variant="ghost" className="h-10 w-full rounded-xl text-sm" disabled={busy} onClick={() => confirm("other")}>
                I sent it another way, record it
              </Button>
            </div>
          )}
          {step === "preview" && preview && (
            <div className="space-y-3">
              <div className="rounded-lg border bg-muted/40 p-2 text-sm">
                <p className="truncate"><span className="text-muted-foreground">To: </span><strong>{preview.to}</strong></p>
                <p className="break-words"><span className="text-muted-foreground">Subject: </span>{preview.subject}</p>
              </div>
              <iframe title="Email preview" data-testid="final-email-frame" srcDoc={preview.html} sandbox="" className="h-[46vh] w-full rounded-lg border bg-white" />
              <DialogFooter className="flex-row gap-2 sm:gap-2">
                <Button variant="outline" className="h-11 flex-1" disabled={busy} onClick={() => setStep("choose")}>Back</Button>
                <Button data-testid="final-email-send" disabled={busy} className="h-11 flex-1 bg-orange-500 text-white hover:bg-orange-600" onClick={sendEmail}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Send
                </Button>
              </DialogFooter>
            </div>
          )}
          {step === "emailed" && emailed && (
            <div className="space-y-3">
              <p data-testid="final-emailed" className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-base font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
                <span>{emailed.duplicate ? `Already emailed at ${at(emailed.at)}, not sent again.` : `Emailed to ${emailed.to} at ${at(emailed.at)}`}</span>
              </p>
              <Button className="h-11 w-full" onClick={() => { setOpen(false); reset(); }}>Done</Button>
            </div>
          )}
          {step === "confirm" && (
            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="ghost" onClick={() => { setOpen(false); reset(); toast.message("Not recorded. Nothing was sent by the app."); }}>Not sent</Button>
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
