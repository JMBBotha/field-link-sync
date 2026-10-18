import { useEffect, useRef, useState } from "react";
import { REMOTE_QUOTE_NOTICE } from "@/lib/remoteQuoteClause";
import { useQueryClient } from "@tanstack/react-query";
import { Textarea } from "@/components/ui/textarea";
import { useQuery } from "@tanstack/react-query";
import { Mail, Loader2, Download, Link2, Eye } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
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
import SendStateButton, { type SendButtonState } from "./SendStateButton";
import { FlConfirmDialog } from "./FlConfirmDialog";
import "./fl-send.css";
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
  const emailCardRef = useRef<HTMLElement | null>(null);
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
  // Display-only state for the coloured buttons (17 Oct restyle; send logic unchanged).
  const [sentInfo, setSentInfo] = useState<{ to: string; at: string } | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "done" | "failed">("idle");
  const [pdfState, setPdfState] = useState<"idle" | "done" | "failed">("idle");
  useEffect(() => { if (!open) { setSentInfo(null); setCopyState("idle"); setPdfState("idle"); } }, [open]);
  const sentToThis = !!sentInfo && sentInfo.to === email.trim().toLowerCase();
  const emailState: SendButtonState =
    busy === "email" ? (slow ? "slow" : "busy")
    : activeSend || localLock ? "busy"
    : sentToThis ? "done"
    : lastFailed ? "failed"
    : "idle";
  // Display only: when the email state turns failed, bring the email card into view
  // (the Retry action itself lives in the sticky footer so it's always visible).
  useEffect(() => {
    if (open && emailState === "failed") {
      const t = window.setTimeout(() => emailCardRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }), 60);
      return () => window.clearTimeout(t);
    }
  }, [open, emailState]);

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
    // Phone/online quote: start the client message with the site-check line (the rep can edit or clear it).
    if ((quote as any).remote_quote) setMessage((m) => (m.trim() ? m : REMOTE_QUOTE_NOTICE));
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
      setCopyState("done");
      window.setTimeout(() => setCopyState("idle"), 2500);
      toast({ title: "Link copied", description: "Send it to your client anywhere." });
    } catch {
      setCopyState("failed");
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
      setPdfState("done");
    } catch (err) {
      setPdfState("failed");
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
        setSentInfo({ to: to.toLowerCase(), at: new Date().toISOString() });
        toast({ title: "Quote emailed", description: `Sent to ${to}` });
        qc.invalidateQueries({ queryKey: ["quotes"] });
        qc.invalidateQueries({ queryKey: ["quote-document", quoteId] });
      }
    } catch (err) {
      // Unexpected: still check the record before unlocking, so a send that went through is reported.
      const row = await waitForSendResult(quoteId, sendId);
      if (row?.status === "sent") {
        setSent((s) => ({ ...s, email: true }));
        setSentInfo({ to: to.toLowerCase(), at: row.finished_at || new Date().toISOString() });
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

  const checks = [
    ["terms", "I've checked the terms and conditions"],
    ["brochure", "I've checked the unit info / brochure details"],
    ["pricing", "I've checked the pricing"],
  ] as const;
  const approvedCount = checks.filter(([k]) => approved[k]).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="fl-send sm:max-w-lg max-h-[92dvh] gap-0 overflow-y-auto p-0" data-testid="send-quote-dialog">
        <DialogHeader className="space-y-1.5 px-5 pb-3 pt-5 text-left sm:text-left">
          <div className="fl-send-eyebrow">Send quote</div>
          <DialogTitle className="fl-send-title pr-6">Send quote {quoteNumber} to client</DialogTitle>
          <DialogDescription className="fl-send-sub">
            Share the live quote link with {resolvedCustomerName || "the client"} — they can view and accept it online.
          </DialogDescription>
          {total > 0 && <div><span className="fl-send-total">{formatRand(total)} incl. VAT</span></div>}
        </DialogHeader>

        <div className="space-y-3 px-5 pb-4">
          {/* Primary send: live client link via copy / WhatsApp */}
          <section className="fl-send-card space-y-2">
            <div className="fl-send-label">Client link</div>
            {clientUrl ? (
              <>
                <Input readOnly value={clientUrl} className="fl-send-field font-mono text-[13px]" onFocus={(e) => e.target.select()} />
                <div className="flex flex-wrap gap-2">
                  <SendStateButton
                    state={copyState} small onClick={handleCopyLink} title="Copy client link" testId="send-copy-link"
                    icon={<Link2 className="h-4 w-4" />} labels={{ idle: "Copy link", done: "Link copied ✓", failed: "Copy failed" }}
                  />
                  {/* Test-only WhatsApp: always goes to Johan, never the client. */}
                  <WhatsAppShareButton phone={JOHAN_TEST_WHATSAPP} message={shareMessage} variant="outline" className="fl-sbtn is-outline is-sm h-9 shrink-0">
                    <span className="flex items-center gap-1.5">WhatsApp (test)</span>
                  </WhatsAppShareButton>
                </div>
              </>
            ) : (
              <p className="fl-send-note flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating client link…</p>
            )}
          </section>

          {/* Sign-off before emailing */}
          <section className="fl-send-card space-y-2" data-testid="send-approval">
            <div className="fl-send-label">Sign off before emailing <b>{approvedCount} of 3</b></div>
            {checks.map(([k, label]) => (
              <label key={k} className={`fl-send-check${approved[k] ? " is-on" : ""}`}>
                <input type="checkbox" data-testid={`approve-${k}`}
                  checked={approved[k]} onChange={(e) => setApproved((a) => ({ ...a, [k]: e.target.checked }))} />
                {label}
              </label>
            ))}
            {!allApproved && <p className="fl-send-note">Tick all three to unlock Email.</p>}
          </section>

          {/* Email the quote */}
          <section ref={emailCardRef} className="fl-send-card space-y-2.5">
            <Label htmlFor="send-quote-email" className="fl-send-label">Email address</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="send-quote-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="client@example.com"
                className="fl-send-field min-w-0 flex-1"
              />
              <SendStateButton
                state={emailState}
                testId="send-quote-email-button"
                className="w-full sm:w-auto sm:min-w-[9.5rem]"
                icon={<Mail className="h-4 w-4" />}
                disabled={busy !== null || sendLocked || emailUnavailable || !allApproved || emailState === "done" || emailState === "failed"}
                onClick={() => void handleEmail()}
                labels={{ idle: "Email", busy: "Email sending…", slow: "Still sending, please wait", done: "Email sent ✓", failed: "Not sent" }}
              />
            </div>
            {activeSend && busy !== "email" && (
              <div className="fl-send-status tone-amber" data-testid="send-in-progress">
                <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
                <span>Sending… started {sastTime(activeSend.started_at)} to {activeSend.recipient}. Please wait, don't resend.</span>
              </div>
            )}
            {busy === "email" && slow && (
              <div className="fl-send-status tone-amber" data-testid="send-slow">
                <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
                <span>Still sending, please wait, don't resend.</span>
              </div>
            )}
            {emailState === "done" && sentInfo && (
              <div className="fl-send-status tone-green items-center justify-between" data-testid="send-done">
                <span>Sent to {sentInfo.to} at {sastTime(sentInfo.at)}.</span>
                <button type="button" className="fl-send-link shrink-0" onClick={() => setRecentAsk({ to: sentInfo.to, at: sentInfo.at })}>Send again</button>
              </div>
            )}
            {lastFailed && emailState === "failed" && (
              <div className="fl-send-status tone-red" data-testid="send-failed">
                <span><b>Not sent</b> to {lastFailed.recipient} ({sastTime(lastFailed.finished_at || lastFailed.started_at)}): {lastFailed.error || "unknown error"}</span>
              </div>
            )}
            {emailUnavailable && (
              <div className="fl-send-status tone-red">Email not configured — use Copy link or Download PDF.</div>
            )}

            <Label htmlFor="send-quote-message" className="fl-send-label pt-1">Message to client (optional)</Label>
            <Textarea
              id="send-quote-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Thank you for the opportunity. Your quotation is ready to view online."
              rows={4}
              className="fl-send-field"
            />
            <SendStateButton state={busy === "preview" ? "busy" : "idle"} outline small onClick={handlePreview} disabled={busy !== null}
              icon={<Eye className="h-4 w-4" />} labels={{ idle: "Preview email", busy: "Loading preview…" }} />
            <Label htmlFor="send-quote-cc" className="fl-send-label pt-1">Extra email addresses (optional)</Label>
            <Input
              id="send-quote-cc"
              value={extraEmails}
              onChange={(e) => setExtraEmails(e.target.value)}
              placeholder="me@company.com, other@company.com"
              className="fl-send-field"
            />
            <p className="fl-send-note">Separate multiple addresses with a comma — they each get a copy.</p>
            <label className={`fl-send-check${copyToCompany ? " is-on" : ""}`}>
              <input type="checkbox" checked={copyToCompany} onChange={(e) => setCopyToCompany(e.target.checked)} />
              Also send a copy to our company email
            </label>
            <button type="button" onClick={handleDownload} disabled={busy !== null} className="fl-send-link">
              {busy === "pdf" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Download the quote PDF file
            </button>
          </section>
        </div>

        <DialogFooter className="fl-send-foot sticky bottom-0 flex-col gap-2 px-5 py-3 sm:flex-col sm:space-x-0">
          {lastFailed && emailState === "failed" && (
            <div className="fl-send-failbar" role="alert" data-testid="send-failed-bar">
              <div className="min-w-0 flex-1">
                <div className="fl-send-failbar-title">Not sent</div>
                <div className="fl-send-failbar-reason">{lastFailed.error || "unknown error"}</div>
              </div>
              <SendStateButton state="failed" small className="shrink-0" disabled={busy !== null || sendLocked || !allApproved}
                onClick={() => setRetryAsk(true)} labels={{ idle: "Retry", failed: "Retry" }} testId="send-retry" />
            </div>
          )}
          <div className="flex w-full flex-row items-center justify-between gap-2">
          <SendStateButton
            state={busy === "pdf" ? "busy" : pdfState} outline small onClick={handleDownload} disabled={busy !== null && busy !== "pdf"}
            icon={<Download className="h-4 w-4" />} labels={{ idle: "Download PDF", busy: "Preparing PDF…", done: "PDF ready ✓", failed: "PDF failed, retry" }}
          />
          <button type="button" className="fl-sbtn is-outline is-sm" onClick={() => onOpenChange(false)}>Close</button>
          </div>
        </DialogFooter>
      </DialogContent>

      <FlConfirmDialog
        open={recentAsk !== null}
        onOpenChange={(o) => { if (!o) setRecentAsk(null); }}
        onConfirm={() => { setRecentAsk(null); void handleEmail({ confirmResend: true }); }}
        title="Send again?"
        body={<>This quote was just sent to {recentAsk?.to} at {sastTime(recentAsk?.at)}, send again?</>}
        confirmLabel="Send again"
        tone="amber"
        testId="confirm-send-again"
      />

      <FlConfirmDialog
        open={retryAsk}
        onOpenChange={setRetryAsk}
        onConfirm={() => { setRetryAsk(false); void handleEmail({ retryOf: lastFailed?.id }); }}
        title={`Retry sending ${quoteNumber}?`}
        body={<>The last attempt to {lastFailed?.recipient} was NOT sent: {lastFailed?.error || "unknown error"}. Retry now to {email.trim() || lastFailed?.recipient}?</>}
        confirmLabel="Retry send"
        tone="red"
        testId="confirm-retry"
      />

      {clientPdf && <ClientQuotePdfRoot quoteId={quoteId} />}

      {/* Email preview popup — shows the exact email that will be sent. */}
      <Dialog open={previewHtml !== null} onOpenChange={(o) => { if (!o) setPreviewHtml(null); }}>
        <DialogContent className="fl-send sm:max-w-2xl max-h-[92dvh] overflow-y-auto">
          <DialogHeader className="text-left sm:text-left">
            <div className="fl-send-eyebrow">Preview</div>
            <DialogTitle className="fl-send-title">Email preview</DialogTitle>
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
            className="fl-send-field"
          />
          {previewHtml && (
            <iframe
              title="Email preview"
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              srcDoc={previewHtml.includes("<head>") ? previewHtml.replace("<head>", '<head><base target="_blank">') : `<base target="_blank">${previewHtml}`}
              className="h-[50vh] w-full rounded-md border border-border bg-white"
            />
          )}
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
            <SendStateButton state={busy === "preview" ? "busy" : "idle"} outline onClick={handlePreview} disabled={busy !== null}
              icon={<Eye className="h-4 w-4" />} labels={{ idle: "Update preview", busy: "Updating…" }} />
            <SendStateButton state="idle" onClick={() => setPreviewHtml(null)} labels={{ idle: "Done — keep this wording" }} />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
};

export default SendQuoteDialog;
