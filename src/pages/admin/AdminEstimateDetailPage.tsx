import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, FileCheck2, Send, Download, Printer, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useRegisterAssistantContext } from "@/hooks/useAssistantContextTracker";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { convertQuoteToInvoice, buildQuoteLineItems } from "@/lib/convertQuoteToInvoice";
import { generateDocumentPdf } from "@/lib/documentPdf";
import { loadQuoteBrochuresForPdf } from "@/lib/quoteBrochuresForPdf";
import { ensureQuoteReadyToSend } from "@/lib/quoteSend";
import SendQuoteDialog from "@/components/quoting/SendQuoteDialog";
import EstimateBuilder from "@/components/quoting/EstimateBuilder";
import VoiceQuoteStrip from "@/components/quoting/VoiceQuoteStrip";
import MandyQuoteActions from "@/components/mandy/MandyQuoteActions";
import StatusPill from "@/components/shared/StatusPill";
import RowMenu from "@/components/shared/RowMenu";
import { useQuoteStaffActions } from "@/components/quoting/useQuoteStaffActions";

import AcceptedWorkSection from "@/components/quoting/AcceptedWorkSection";
import DepositPaymentChip from "@/components/shared/DepositPaymentChip";
import { fetchQuoteInvoice } from "@/lib/depositInvoice";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { QuoteProvider, usePendingQuoteWrites, waitForQuoteWrites } from "@/contexts/QuoteContext";
import { missingLabourFor, normalizeLabourMode } from "@/lib/areaLabour";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";


/**
 * Read-only, client-facing estimate document view.
 * This is the default target when opening an estimate; the Quote Builder is
 * reached from the "Edit" action here.
 */
const AdminEstimateDetailPage = () => {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { settings } = useCompanySettings();
  const [busy, setBusy] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [missingLabour, setMissingLabour] = useState<{ id: string; name: string }[]>([]);
  const checkLabour = async () => {
    const [areaRes, lineRes, modeRes] = await Promise.all([
      supabase.from("quote_areas").select("id, name").eq("quote_id", id).order("sort_order"),
      supabase.from("quote_items").select("id, area_id, parent_item_id, item_name, item_type, quantity, metadata").eq("quote_id", id),
      (supabase.from("quotes") as any).select("labour_mode").eq("id", id).maybeSingle(),
    ]);
    if (areaRes.error) throw areaRes.error;
    if (lineRes.error) throw lineRes.error;
    const missing = missingLabourFor(normalizeLabourMode(modeRes.data?.labour_mode), (areaRes.data || []) as any[], (lineRes.data || []) as any[], settings.default_install_labour_hours);
    if (missing.length) { setMissingLabour(missing); return false; }
    return true;
  };
  const staffActions = useQuoteStaffActions(undefined, checkLabour);
  const pendingWrites = usePendingQuoteWrites();
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (pendingWrites <= 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [pendingWrites]);
  const goBack = async () => {
    setLeaving(true);
    const done = await waitForQuoteWrites(5000);
    setLeaving(false);
    if (!done && !window.confirm("Changes are still saving. Leave anyway?")) return;
    navigate("/admin/quotes");
  };

  const { data: quote, isLoading } = useQuery({
    queryKey: ["quote-document", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotes")
        .select("*, customers(name, company_name, address, email, phone)")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
    enabled: !!id,
  });

  // Tell the voice assistant which quote is open on screen.
  useRegisterAssistantContext({
    open_quote_id: id,
    open_quote_number: quote?.quote_number ?? undefined,
    open_quote_status: quote?.status ?? undefined,
    selected_customer_id: quote?.customer_id ?? undefined,
    selected_customer_name: quote?.customer_name ?? undefined,
  });

  const { data: items = [], isFetched: itemsFetched } = useQuery({
    queryKey: ["quote-document-items", id],
    queryFn: () => buildQuoteLineItems(id, quote?.visual_sections),
    enabled: !!id && !!quote,
  });




  const customer = quote?.customers || {};
  const subtotal = Number(quote?.subtotal) || 0;
  const taxAmount = Number(quote?.vat_amount) || 0;
  const total = Number(quote?.total) || 0;

  /** Standard workflow: only an accepted estimate may become a billable invoice. */
  const canConvert = String(quote?.status || "").toLowerCase() === "accepted";

  const { data: depositInvoice } = useQuery({
    queryKey: ["quote-deposit-invoice", id],
    enabled: !!id && canConvert,
    queryFn: () => fetchQuoteInvoice(id),
  });

  /** Re-read the document + line items after an inline edit (DB trigger recalcs totals). */
  const refreshDocument = () => {
    qc.invalidateQueries({ queryKey: ["quote-document", id] });
    qc.invalidateQueries({ queryKey: ["quote-document-items", id] });
  };

  /**
   * Explicit Save: flush any focused field (inline edits commit on blur), recompute
   * totals from the persisted lines, and confirm. Status is never advanced here —
   * a draft stays a draft; Send is the only thing that changes status.
   */
  const handleSave = async () => {
    if (!await checkLabour()) return;
    setBusy("save");
    try {
      (document.activeElement as HTMLElement | null)?.blur?.();
      await new Promise((r) => setTimeout(r, 250));

      const { data: lines, error: linesErr } = await supabase
        .from("quote_items")
        .select("quantity, unit_price, parent_item_id")
        .eq("quote_id", id);
      if (linesErr) throw linesErr;

      const sub = (lines || [])
        .filter((l: any) => !l.parent_item_id)
        .reduce((s: number, l: any) => s + Number(l.quantity || 0) * Number(l.unit_price || 0), 0);
      const rate = Number(quote?.vat_rate) || 0.15;
      const dType = quote?.discount_type as string | null;
      const dVal = Number(quote?.discount_value || 0);
      const disc = dType === "percentage" || dType === "percent" ? (sub * dVal) / 100 : dType === "fixed" ? dVal : 0;
      const net = sub - disc;

      const { error: upErr } = await supabase
        .from("quotes")
        .update({
          subtotal: Math.round(sub * 100) / 100,
          vat_amount: Math.round(net * rate * 100) / 100,
          total: Math.round(net * (1 + rate) * 100) / 100,
        })
        .eq("id", id);
      if (upErr) throw upErr;

      refreshDocument();
      const isDraft = String(quote?.status || "").toLowerCase() === "draft";
      toast({ title: isDraft ? "Saved as draft" : "Saved" });
    } catch (e: any) {
      toast({ title: "Could not save", description: e.message, variant: "destructive" });
    }
    setBusy(null);
  };


  // Send uses the exact same flow as the quote builder: ensure public_token
  // + status/sent_at via the shared helper, then open the shared dialog.
  const handleSend = async () => {
    if (!await checkLabour()) return;
    setBusy("send");
    try {
      await ensureQuoteReadyToSend(id);
      qc.invalidateQueries({ queryKey: ["quote-document", id] });
      qc.invalidateQueries({ queryKey: ["quotes"] });
      setSendOpen(true);
    } catch (e: any) {
      toast({ title: "Could not prepare quote for sending", description: e.message, variant: "destructive" });
    }
    setBusy(null);
  };

  // Mandy on the full builder hands "make the PDF" off here (?mandy=pdf); run it once.
  const [searchParams, setSearchParams] = useSearchParams();
  const mandyPdfRan = useRef(false);
  useEffect(() => {
    if (searchParams.get("mandy") !== "pdf" || mandyPdfRan.current || !quote || isLoading || !itemsFetched) return;
    mandyPdfRan.current = true;
    setSearchParams({}, { replace: true });
    void handlePdf();
  }, [searchParams, quote, isLoading, itemsFetched]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePdf = async () => {
    if (!await checkLabour()) return "Remember labour before generating the PDF.";
    setBusy("pdf");
    try {
      const extras = await loadQuoteBrochuresForPdf((quote as any)?.id);
      await generateDocumentPdf({
        ...extras,
        docType: "Quote",
        docNumber: quote?.quote_number || "DRAFT",
        companyName: settings.company_name || "0800-BE-COOL",
        companyAddress: settings.physical_address,
        vatNumber: settings.vat_number,
        customerName: customer.name || quote?.customer_name || "Customer",
        customerAddress: customer.address || undefined,
        customerEmail: customer.email || undefined,
        issueDate: quote?.created_at,
        lineItems: items,
        subtotal,
        taxRate: Number(quote?.vat_rate) || 0.15,
        taxAmount,
        total,
        notes: quote?.notes || undefined,
        captureSelector: '[data-pdf-capture-root="estimate"]',
      });
    } catch (e: any) {
      toast({ title: "PDF failed", description: e.message, variant: "destructive" });
    }
    setBusy(null);
  };

  const handleConvert = async () => {
    if (!user?.id) return;
    setBusy("convert");
    try {
      const invoiceId = await convertQuoteToInvoice(id, user.id);
      qc.invalidateQueries({ queryKey: ["quotes"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: "Invoice created", description: "Draft invoice generated from estimate." });
      navigate(`/admin/invoices?highlight=${invoiceId}`);
    } catch (e: any) {
      toast({ title: e.message || "Conversion failed", variant: "destructive" });
    }
    setBusy(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={() => navigate("/admin/quotes")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <p className="mt-8 text-center text-muted-foreground">Estimate not found</p>
      </div>
    );
  }

  return (
    <div className="estimate-page mx-auto min-h-full max-w-4xl space-y-3 px-2 pt-2 pb-[calc(8rem+env(safe-area-inset-bottom,0px))] sm:px-3">
      {/* Header */}
      <div className="flex h-9 items-center justify-between print:hidden">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => void goBack()} disabled={leaving} aria-label="Back">
          {leaving ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowLeft className="h-5 w-5" />}
        </Button>
        <h1 className="text-base font-bold">
          Estimate {quote.quote_number}
          <span data-pdf-hide className="ml-2 text-xs font-normal text-muted-foreground print:hidden" aria-live="polite">
            {pendingWrites > 0 || leaving ? "Saving…" : "Saved"}
          </span>
        </h1>
        {staffActions.itemsFor(quote as any).some((i) => !i.hidden)
          ? <RowMenu items={staffActions.itemsFor(quote as any).map((i) => ({ ...i, separatorBefore: false }))} />
          : <div className="w-9" />}
        {staffActions.dialogs}
      </div>

      {/* Status banner */}
      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-4 py-3 print:hidden">
        <span className="text-sm text-muted-foreground">Status</span>
        <StatusPill status={quote.status} />
        {canConvert && <DepositPaymentChip invoice={depositInvoice} accepted />}
        <span className="text-xs text-muted-foreground">
          Created {new Date(quote.created_at).toLocaleDateString("en-ZA")}
        </span>
      </div>

      <AcceptedWorkSection quoteId={quote.id} />

      {/* One surface: the estimate document IS the editor */}
      <QuoteProvider quoteId={quote.id}>
        {/* Quote-by-voice: mutates this same live quote via QuoteContext. */}
        <VoiceQuoteStrip vatRate={Number(quote.vat_rate) || 0.15} onChanged={refreshDocument} />
        {/* Mandy (Grok dock) quote actions — same QuoteContext + PDF handler as the buttons. */}
        <MandyQuoteActions vatRate={Number(quote.vat_rate) || 0.15} onPdf={handlePdf} onChanged={refreshDocument} />
        <EstimateBuilder
          quoteNumber={quote.quote_number}
          issueDate={quote.created_at}
          validUntil={quote.valid_until}
          customerName={customer.name || quote.customer_name || "Customer"}
          customerCompany={customer.company_name}
          customerAddress={customer.address}
          customerEmail={customer.email}
          customerPhone={customer.phone}
          vatRate={Number(quote.vat_rate) || 0.15}
          notes={quote.notes}
          termsText={quote.terms_text}
          onChanged={refreshDocument}
        />
      </QuoteProvider>


      {/* Actions */}
      <div className="flex flex-wrap justify-end gap-2 pt-2 print:hidden">
        <Button variant="outline" onClick={() => navigate(`/admin/quote-builder?quoteId=${quote.id}`)}>
          <Pencil className="mr-2 h-4 w-4" /> Full builder / Visual PDF
        </Button>
        <Button variant="outline" onClick={handleSave} disabled={busy === "save"}>
          {busy === "save" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save
        </Button>
        <Button variant="outline" onClick={handleSend} disabled={busy === "send"}>
          {busy === "send" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          Send
        </Button>

        <Button variant="outline" onClick={handlePdf} disabled={busy === "pdf"}>
          {busy === "pdf" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          PDF
        </Button>
        <Button variant="outline" onClick={async () => { if (await checkLabour()) window.print(); }}>
          <Printer className="mr-2 h-4 w-4" /> Print
        </Button>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  variant="brand"
                  onClick={handleConvert}
                  disabled={busy === "convert" || !canConvert}
                >
                  {busy === "convert" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FileCheck2 className="mr-2 h-4 w-4" />
                  )}
                  Convert to Invoice
                </Button>
              </span>
            </TooltipTrigger>
            {!canConvert && (
              <TooltipContent>
                Estimate must be Accepted before converting to an invoice
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </div>

      <SendQuoteDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        quoteId={quote.id}
        quoteNumber={quote.quote_number}
        customerId={quote.customer_id}
        customerName={customer.name || quote.customer_name || "Customer"}
      />
      <Dialog open={missingLabour.length > 0} onOpenChange={(open) => { if (!open) setMissingLabour([]); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Labour missing</DialogTitle><DialogDescription>Add labour to every populated area before continuing.</DialogDescription></DialogHeader>
          <div className="space-y-1">
            {missingLabour.map((area) => <Button key={area.id} type="button" variant="ghost" className="w-full justify-start" onClick={() => { setMissingLabour([]); window.setTimeout(() => document.getElementById(`area-labour-${area.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 0); }}>{area.name}</Button>)}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminEstimateDetailPage;
