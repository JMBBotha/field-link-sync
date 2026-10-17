import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Textarea } from "@/components/ui/textarea";
import { useQuery } from "@tanstack/react-query";
import { Mail, Loader2, Check, Download, Link2, Eye } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { buildQuoteLineItems } from "@/lib/convertQuoteToInvoice";
import { generateDocumentPdfBlob } from "@/lib/documentPdf";
import { savePdfFile } from "@/components/quoting/QuotePdfViewer";
import { loadQuoteBrochuresForPdf } from "@/lib/quoteBrochuresForPdf";
import ClientQuotePdfRoot, { waitForClientPdfRoot, clientBrochureSelector } from "./ClientQuotePdfRoot";
import WhatsAppShareButton from "@/components/WhatsAppShareButton";
import { formatRand } from "@/utils/formatRand";
import { publicQuoteUrl } from "@/lib/publicAppUrl";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
  useQuoteEmailSendState, quoteEmailSendKey, readSendReply, waitForSendResult, sastTime,
  setLocalSendLock, clearLocalSendLock, getLocalSendLock, LOCAL_SEND_LOCK_EVENT, type SendReply,
} from "@/lib/quoteEmailSend";

interface SendQuoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quoteId: string;
  quoteNumber: string;
  customerId: string | null;
  customerName: string;
}

/**
 * LOCKED: WhatsApp sends from this dialog go ONLY to Johan's test number.
 * For clients, use Copy link or Email PDF — never WhatsApp arbitrary numbers.
 */
const JOHAN_TEST_WHATSAPP = "+27696838624";

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Pulls the real message out of a failed functions.invoke response. */
async function readInvokeError(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.text === "function") {
    try {
      const body = await ctx.text();
      if (body) return body;
    } catch {
      /* fall through to the generic message */
    }
  }
  return error instanceof Error ? error.message : "Please try again.";
}

/**
 * Sends the SAVED quote to a client by email/WhatsApp, and lets the user
 * download it. The PDF is always generated from the same EstimateDocument
 * component and DOM-capture pipeline used by the read-only estimate page
 * (`/admin/estimates/:id`), so what gets downloaded or emailed here is
 * guaranteed to match the "new" estimate/invoice template exactly — never
 * the legacy react-pdf layout.
 */
const SendQuoteDialog = ({
  open,
  onOpenChange,
  quoteId,
  quoteNumber,
  customerId,
  customerName,
}: SendQuoteDialogProps) => {
  const { settings } = useCompanySettings();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [extraEmails, setExtraEmails] = useState("");
  const [copyToCompany, setCopyToCompany] = useState(true);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"email" | "pdf" | "preview" | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [sent, setSent] = useState<{ email: boolean }>({ email: false });
  const [approved, setApproved] = useState({ terms: false, brochure: false, pricing: false });
  // Set once the backend tells us email isn't configured — we then stop
  // offering the Email button and point the user at Copy link / Download PDF.
  const [emailUnavailable, setEmailUnavailable] = useState(false);
  // Duplicate-send guard (17 Oct 2026): one in-flight send per quote, server-confirmed.
  const qc = useQueryClient();
  const inFlightRef = useRef(false);
  const [slow, setSlow] = useState(false);
  const [recentAsk, setRecentAsk] = useState<{ to: string; at: string } | null>(null);
  const [retryAsk, setRetryAsk] = useState(false);
  const { data: sendState } = useQuoteEmailSendState(quoteId, open);
  const [localLock, setLocalLock] = useState(() => (quoteId ? getLocalSendLock(quoteId) : null));
  useEffect(() => {
    const read = () => setLocalLock(quoteId ? getLocalSendLock(quoteId) : null);
    read();
    window.addEventListener(LOCAL_SEND_LOCK_EVENT, read);
    const t = window.setInterval(read, 5000);
    return () => { window.removeEventListener(LOCAL_SEND_LOCK_EVENT, read); window.clearInterval(t); };
  }, [quoteId, open]);
  const activeSend = sendState?.active || null;
  const lastSend = sendState?.last || null;
  const lastFailed = !activeSend && lastSend?.status === "failed" ? lastSend : null;
  const sendLocked = busy === "email" || !!activeSend || !!localLock;

  // Resolve email + recipient phone from THIS quote's own records — never from
  // the customer's latest lead. Phone: quote's customer row first, then the
  // lead tied to THIS quote (quotes.lead_id) as fallback. (SA +27 normalisation
  // happens inside WhatsAppShareButton.)


  // Fetch the freshly-saved quote (plus customer + line items) straight from
  // the DB whenever the dialog opens, so the PDF we build/send always
  // reflects exactly what was just persisted — same source data as the
  // canonical estimate view.
  const { data: quote } = useQuery({
    queryKey: ["send-quote-doc", quoteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotes")
        .select("*, customers(name, company_name, address, email, phone)")
        .eq("id", quoteId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
    enabled: open && !!quoteId,
  });

  // Effect must sit below the quote query — it reads `quote` in its deps.
  useEffect(() => {
    if (!open || !quote) return;
    const q = quote as {
      lead_id?: string | null;
      customers?: { email?: string | null } | null;
    };
    setEmail(q.customers?.email || "");
    setLeadId(q.lead_id ?? null);
    // Sign-off resets every time the window opens or the quote changes.
    setApproved({ terms: false, brochure: false, pricing: false });
  }, [open, quote]);
  const allApproved = approved.terms && approved.brochure && approved.pricing;


  const { data: items = [] } = useQuery({
    queryKey: ["send-quote-doc-items", quoteId, quote?.visual_sections],
    queryFn: () => buildQuoteLineItems(quoteId, quote?.visual_sections),
    enabled: open && !!quoteId && !!quote,
  });

  const [clientPdf, setClientPdf] = useState(false);

  const customer = quote?.customers || {};
  const subtotal = Number(quote?.subtotal) || 0;
  const taxAmount = Number(quote?.vat_amount) || 0;
  const total = Number(quote?.total) || 0;
  const resolvedCustomerName = customer.name || quote?.customer_name || customerName || "Customer";

  // Client link: /quote/:token → ClientProposalView (accept flow).
  const publicToken = quote?.public_token || null;
  const clientUrl = publicToken ? publicQuoteUrl(publicToken) : null;
  const shareMessage = clientUrl
    ? `Hi ${resolvedCustomerName}, your quote ${quoteNumber} for ${formatRand(total)} is ready. View and accept it here: ${clientUrl}`
    : "";

  const handleCopyLink = async () => {
    if (!clientUrl) return;
    try {
      await navigator.clipboard.writeText(clientUrl);
      toast({ title: "Link copied", description: "Send it to your client anywhere." });
    } catch {
      toast({ title: "Copy failed", description: clientUrl, variant: "destructive" });
    }
  };

  const buildPdf = async (): Promise<Blob> => {
    if (!quote) throw new Error("Quote not loaded yet — please wait a moment and try again.");
    setClientPdf(true);
    try {
      const extras = await loadQuoteBrochuresForPdf(quoteId);
      const captureSelector = await waitForClientPdfRoot(quoteId);
      return await generateDocumentPdfBlob({
        ...extras,
        docType: "Quote",
        docNumber: quote.quote_number || quoteNumber || "DRAFT",
        companyName: settings.company_name || "0800-BE-COOL",
        companyAddress: settings.physical_address,
        vatNumber: settings.vat_number,
        customerName: resolvedCustomerName,
        customerAddress: customer.address || undefined,
        customerEmail: customer.email || undefined,
        issueDate: quote.created_at,
        lineItems: items,
        subtotal,
        taxRate: Number(quote.vat_rate) || 0.15,
        taxAmount,
        total,
        notes: quote.notes || undefined,
        captureSelector,
        extraPageSelector: clientBrochureSelector(quoteId),
      });
    } finally {
      setClientPdf(false);
    }
  };

  const handleDownload = async () => {
    setBusy("pdf");
    try {
      const blob = await buildPdf();
      const url = URL.createObjectURL(blob);
      // Phones: share sheet with the file (stays in the app), else a blob download (Johan 20:51).
      await savePdfFile(url, `${quoteNumber || "quote"}.pdf`);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast({
        title: "PDF failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  // Preview the exact email HTML (no PDF, nothing sent) so wording can be checked first.
  const handlePreview = async () => {
    setBusy("preview");
    try {
      const { data, error } = await supabase.functions.invoke("send-quote-email", {
        body: {
          previewOnly: true,
          to: email.trim() || "client@example.com",
          subject: `Your quote ${quoteNumber}`,
          quoteNumber,
          quoteId,
          customerId,
          quoteUrl: clientUrl,
          clientName: resolvedCustomerName,
          totalAmount: total,
          message: message.trim() || undefined,
        },
      });
      if (error) throw new Error(await readInvokeError(error));
      const html = (data as { html?: string } | null)?.html;
      if (!html) throw new Error("No preview came back — please try again.");
      setPreviewHtml(html);
    } catch (err) {
      toast({
        title: "Preview failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const handleEmail = async (opts: { confirmResend?: boolean; retryOf?: string } = {}) => {
    if (!allApproved) return;
    // Two rapid taps fire once: the ref flips synchronously, before React re-renders.
    if (inFlightRef.current) return;
    if (!email.trim()) {
      toast({ title: "Email required", description: "Add a client email address first.", variant: "destructive" });
      return;
    }
    if (activeSend || (quoteId && getLocalSendLock(quoteId))) {
      toast({ title: "Already sending", description: activeSend ? `Sending to ${activeSend.recipient} started ${sastTime(activeSend.started_at)}. Please wait.` : "Please wait for the current send to finish." });
      return;
    }
    inFlightRef.current = true;
    const to = email.trim();
    const sendId = crypto.randomUUID();
    setBusy("email");
    setSlow(false);
    setLocalSendLock(quoteId, sendId);
    // After 90 s we only change the message: the request stays alive and the button stays locked.
    const slowTimer = window.setTimeout(() => setSlow(true), 90000);
    const refresh = () => qc.invalidateQueries({ queryKey: quoteEmailSendKey(quoteId) });
    const common = { to, quoteId, quoteNumber, customerId, sendId, retryOf: opts.retryOf, confirm_resend: opts.confirmResend === true };

    const handleReply = async (r: SendReply): Promise<boolean> => {
      switch (r.kind) {
        case "ok": return true;
        case "recent": setRecentAsk({ to: r.sentTo || to, at: r.sentAt }); return false;
        case "in_progress":
          toast({ title: "Already sending", description: `Sending to ${r.sentTo} started ${sastTime(r.startedAt)}. Please wait, don't resend.` });
          return false;
        case "skipped": toast({ title: "Not sent", description: r.reason, variant: "destructive" }); return false;
        case "not_configured":
          setEmailUnavailable(true);
          toast({ title: "Email not configured", description: "Quote email isn't set up yet. Use Copy link or Download PDF for now.", variant: "destructive" });
          return false;
        case "failed": toast({ title: "Not sent", description: r.reason, variant: "destructive" }); return false;
        case "unknown": {
          // The server may still be sending: wait for its record instead of guessing.
          setSlow(true);
          const row = await waitForSendResult(quoteId, sendId);
          if (row?.status === "sent") return true;
          toast({ title: "Not sent", description: row?.error || r.reason, variant: "destructive" });
          return false;
        }
      }
    };

    try {
      // 1) Take the server lock before the (slow) PDF build.
      const begin = await supabase.functions.invoke("send-quote-email", { body: { ...common, beginSend: true } });
      const beginReply = await readSendReply(begin.data, begin.error);
      if (beginReply.kind === "unknown") {
        toast({ title: "Could not start the send", description: `${beginReply.reason}. Nothing was emailed; try again in a moment.`, variant: "destructive" });
        return;
      }
      if (beginReply.kind !== "ok") { await handleReply(beginReply); return; }
      refresh();

      // 2) Build the PDF. A failure here is recorded server-side with the reason (nothing emailed).
      let pdfBase64: string;
      try {
        pdfBase64 = await blobToBase64(await buildPdf());
      } catch (pdfErr) {
        const reason = `The quote PDF could not be built: ${pdfErr instanceof Error ? pdfErr.message : String(pdfErr)}`;
        await supabase.functions.invoke("send-quote-email", { body: { ...common, reportFailure: true, reason } });
        toast({ title: "Not sent", description: reason, variant: "destructive" });
        return;
      }

      // 3) Send. The server records the send log and marks the quote sent once Resend accepts it.
      const res = await supabase.functions.invoke("send-quote-email", {
        body: {
          ...common,
          subject: `Your quote ${quoteNumber}`,
          quoteUrl: clientUrl,
          clientName: resolvedCustomerName,
          totalAmount: total,
          unsubscribeToken: crypto.randomUUID(),
          pdfBase64,
          message: message.trim() || undefined,
          copyToCompany,
          cc: extraEmails.trim() || undefined,
        },
      });
      if (await handleReply(await readSendReply(res.data, res.error))) {
        setSent((s) => ({ ...s, email: true }));
        toast({ title: "Quote emailed", description: `Sent to ${to}` });
        qc.invalidateQueries({ queryKey: ["quotes"] });
        qc.invalidateQueries({ queryKey: ["quote-document", quoteId] });
      }
    } catch (err) {
      // Unexpected: still check the record before unlocking, so a send that went through is reported.
      const row = await waitForSendResult(quoteId, sendId);
      if (row?.status === "sent") {
        setSent((s) => ({ ...s, email: true }));
        toast({ title: "Quote emailed", description: `Sent to ${to}` });
      } else {
        toast({ title: "Not sent", description: row?.error || (err instanceof Error ? err.message : "Please try again."), variant: "destructive" });
      }
    } finally {
      window.clearTimeout(slowTimer);
      clearLocalSendLock(quoteId, sendId);
      inFlightRef.current = false;
      setSlow(false);
      setBusy(null);
      refresh();
    }
  };

  // No client-facing WhatsApp send here: copy link or email the PDF instead.

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send quote {quoteNumber} to client</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Share the live quote link with {resolvedCustomerName || "the client"} — they can view and accept it online.
          </DialogDescription>
        </DialogHeader>

        {/* Primary send: live client link via copy / WhatsApp */}
        <div className="space-y-1.5">
          <Label className="text-xs">Client link</Label>
          {clientUrl ? (
            <div className="flex gap-2">
              <Input readOnly value={clientUrl} className="h-9 text-sm font-mono" onFocus={(e) => e.target.select()} />
              <Button onClick={handleCopyLink} className="h-9 shrink-0 gap-1.5" title="Copy client link">
                <Link2 className="h-4 w-4" />
                Copy link
              </Button>
              {/* Test-only WhatsApp: always goes to Johan, never the client. */}
              <WhatsAppShareButton
                phone={JOHAN_TEST_WHATSAPP}
                message={shareMessage}
                variant="outline"
                className="h-9 shrink-0"
              >
                <span className="flex items-center gap-1.5">WhatsApp (test)</span>
              </WhatsAppShareButton>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Generating client link…</p>
          )}
        </div>

        {/* Secondary: email the PDF */}
        <div className="space-y-3 border-t border-border pt-3">
          <div className="space-y-1.5 rounded-md border border-primary/40 bg-primary/5 p-2.5" data-testid="send-approval">
            <p className="text-xs font-semibold">Sign off before emailing</p>
            {([
              ["terms", "I've checked the terms and conditions"],
              ["brochure", "I've checked the unit info / brochure details"],
              ["pricing", "I've checked the pricing"],
            ] as const).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-xs">
                <input type="checkbox" className="h-4 w-4 accent-primary" data-testid={`approve-${k}`}
                  checked={approved[k]} onChange={(e) => setApproved((a) => ({ ...a, [k]: e.target.checked }))} />
                {label}
              </label>
            ))}
            {!allApproved && <p className="text-[11px] text-muted-foreground">Tick all three to unlock Email.</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="send-quote-email" className="text-xs">Email address</Label>
            <div className="flex gap-2">
              <Input
                id="send-quote-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="client@example.com"
                className="h-9 text-sm"
              />
              <Button onClick={() => void handleEmail()} disabled={busy !== null || sendLocked || emailUnavailable || !allApproved} className="h-9 shrink-0 gap-1.5" data-testid="send-quote-email-button">
                {sendLocked ? <Loader2 className="h-4 w-4 animate-spin" /> : sent.email ? <Check className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                {sendLocked ? "Sending…" : sent.email ? "Sent ✓" : "Email"}
              </Button>
            </div>
            {activeSend && busy !== "email" && (
              <p className="text-xs font-medium text-amber-700 dark:text-amber-400" data-testid="send-in-progress">
                Sending… started {sastTime(activeSend.started_at)} to {activeSend.recipient}. Please wait, don't resend.
              </p>
            )}
            {busy === "email" && slow && (
              <p className="text-xs font-medium text-amber-700 dark:text-amber-400" data-testid="send-slow">Still sending, please wait, don't resend.</p>
            )}
            {lastFailed && busy !== "email" && (
              <div className="flex items-start justify-between gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive" data-testid="send-failed">
                <span><b>Not sent</b> to {lastFailed.recipient} ({sastTime(lastFailed.finished_at || lastFailed.started_at)}): {lastFailed.error || "unknown error"}</span>
                <Button size="sm" variant="destructive" className="h-7 shrink-0" disabled={busy !== null || sendLocked || !allApproved} onClick={() => setRetryAsk(true)}>Retry</Button>
              </div>
            )}
            <Label htmlFor="send-quote-message" className="text-xs">Message to client (optional)</Label>
            <Textarea
              id="send-quote-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Thank you for the opportunity. Your quotation is ready to view online."
              rows={4}
              className="text-sm"
            />
            <Button variant="outline" onClick={handlePreview} disabled={busy !== null} className="h-8 gap-1.5 text-xs">
              {busy === "preview" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
              Preview email
            </Button>
            <Label htmlFor="send-quote-cc" className="text-xs">Extra email addresses (optional)</Label>
            <Input
              id="send-quote-cc"
              value={extraEmails}
              onChange={(e) => setExtraEmails(e.target.value)}
              placeholder="me@company.com, other@company.com"
              className="h-9 text-sm"
            />
            <p className="text-[11px] text-muted-foreground">Separate multiple addresses with a comma — they each get a copy.</p>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={copyToCompany} onChange={(e) => setCopyToCompany(e.target.checked)} />
              Also send a copy to our company email
            </label>
            <button
              type="button"
              onClick={handleDownload}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50"
            >
              {busy === "pdf" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Download the quote PDF file
            </button>
            {emailUnavailable && (
              <p className="text-xs text-destructive">Email not configured — use Copy link or Download PDF.</p>
            )}
          </div>

        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={handleDownload} disabled={busy !== null} className="gap-1.5">
            {busy === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Download PDF
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={recentAsk !== null} onOpenChange={(o) => { if (!o) setRecentAsk(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send again?</AlertDialogTitle>
            <AlertDialogDescription>
              This quote was just sent to {recentAsk?.to} at {sastTime(recentAsk?.at)}, send again?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setRecentAsk(null); void handleEmail({ confirmResend: true }); }}>Send again</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={retryAsk} onOpenChange={setRetryAsk}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retry sending {quoteNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              The last attempt to {lastFailed?.recipient} was NOT sent: {lastFailed?.error || "unknown error"}. Retry now to {email.trim() || lastFailed?.recipient}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setRetryAsk(false); void handleEmail({ retryOf: lastFailed?.id }); }}>Retry send</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {clientPdf && <ClientQuotePdfRoot quoteId={quoteId} />}

      {/* Email preview popup — shows the exact email that will be sent. */}
      <Dialog open={previewHtml !== null} onOpenChange={(o) => { if (!o) setPreviewHtml(null); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Email preview</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              This is exactly what the client receives. Type your own wording below and tap Update preview.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="Message to client"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Thank you for the opportunity. Your quotation is ready to view online."
            rows={3}
            className="text-sm"
          />
          {previewHtml && (
            <iframe
              title="Email preview"
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              srcDoc={previewHtml.includes("<head>") ? previewHtml.replace("<head>", '<head><base target="_blank">') : `<base target="_blank">${previewHtml}`}
              className="h-[50vh] w-full rounded-md border border-border bg-white"
            />
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handlePreview} disabled={busy !== null} className="gap-1.5">
              {busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
              Update preview
            </Button>
            <Button onClick={() => setPreviewHtml(null)}>Done — keep this wording</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
};

export default SendQuoteDialog;
