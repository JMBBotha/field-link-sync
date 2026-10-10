/**
 * Save draft / Send / Download PDF / Print for one quote — shared by the estimate page and the
 * Quote Builder (QuoteActionBar). Moved from AdminEstimateDetailPage; behaviour unchanged.
 */
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { buildQuoteLineItems } from "@/lib/convertQuoteToInvoice";
import { generateDocumentPdf, generateDocumentPdfBlob } from "@/lib/documentPdf";
import QuotePdfViewer, { isPhoneViewport } from "@/components/quoting/QuotePdfViewer";
import { loadQuoteBrochuresForPdf } from "@/lib/quoteBrochuresForPdf";
import ClientQuotePdfRoot, { waitForClientPdfRoot } from "@/components/quoting/ClientQuotePdfRoot";
import { ensureQuoteReadyToSend } from "@/lib/quoteSend";
import SendQuoteDialog from "@/components/quoting/SendQuoteDialog";
import { waitForQuoteWrites } from "@/contexts/QuoteContext";
import { missingLabourFor, normalizeLabourMode } from "@/lib/areaLabour";
import { blockR0Quote } from "@/lib/zeroPriceGuard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type QuoteDocBusy = "save" | "send" | "pdf" | null;

export function useQuoteDocumentActions(quoteId: string | null | undefined, opts: { beforeWrite?: () => Promise<void> | void; onChanged?: () => void } = {}) {
  const id = quoteId || "";
  const { toast } = useToast();
  const qc = useQueryClient();
  const { settings } = useCompanySettings();
  const [busy, setBusy] = useState<QuoteDocBusy>(null);
  const [clientPdf, setClientPdf] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [pdfView, setPdfView] = useState<{ url: string; fileName: string; title: string } | null>(null);
  const closePdfView = () => setPdfView((v) => { if (v) URL.revokeObjectURL(v.url); return null; });
  const [missingLabour, setMissingLabour] = useState<{ id: string; name: string }[]>([]);

  const { data: quote } = useQuery({
    queryKey: ["quote-document", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("quotes").select("*, customers(name, company_name, address, email, phone)").eq("id", id).maybeSingle();
      if (error) throw error;
      return data as any;
    },
    enabled: !!id,
  });
  const customer = quote?.customers || {};

  const flush = async () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    await opts.beforeWrite?.();
    await waitForQuoteWrites(5000);
  };

  const checkLabour = async () => {
    const [areaRes, lineRes, modeRes] = await Promise.all([
      supabase.from("quote_areas").select("id, name").eq("quote_id", id).order("sort_order"),
      supabase.from("quote_items").select("id, area_id, parent_item_id, item_name, item_type, quantity, metadata, unit_price").eq("quote_id", id),
      (supabase.from("quotes") as any).select("labour_mode").eq("id", id).maybeSingle(),
    ]);
    if (areaRes.error) throw areaRes.error;
    if (lineRes.error) throw lineRes.error;
    const missing = missingLabourFor(normalizeLabourMode(modeRes.data?.labour_mode), (areaRes.data || []) as any[], (lineRes.data || []) as any[], settings.default_install_labour_hours);
    if (missing.length) { setMissingLabour(missing); return false; }
    if (blockR0Quote((lineRes.data || []) as any[], toast)) return false;
    return true;
  };

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["quote-document", id] });
    qc.invalidateQueries({ queryKey: ["quote-document-items", id] });
    opts.onChanged?.();
  };

  /** Save draft: flush pending writes, check labour + R0, recompute totals. Never changes status. */
  const handleSave = async () => {
    setBusy("save");
    try {
      await flush();
      await new Promise((r) => setTimeout(r, 250));
      if (!await checkLabour()) return;
      const { data: lines, error: linesErr } = await supabase.from("quote_items").select("quantity, unit_price, parent_item_id").eq("quote_id", id);
      if (linesErr) throw linesErr;
      const sub = (lines || []).filter((l: any) => !l.parent_item_id).reduce((s: number, l: any) => s + Number(l.quantity || 0) * Number(l.unit_price || 0), 0);
      const { data: q } = await supabase.from("quotes").select("status, vat_rate, discount_type, discount_value").eq("id", id).maybeSingle();
      const rate = Number(q?.vat_rate) || 0.15;
      const dType = q?.discount_type as string | null;
      const dVal = Number(q?.discount_value || 0);
      const disc = dType === "percentage" || dType === "percent" ? (sub * dVal) / 100 : dType === "fixed" ? dVal : 0;
      const net = sub - disc;
      const { error: upErr } = await supabase.from("quotes").update({
        subtotal: Math.round(sub * 100) / 100,
        vat_amount: Math.round(net * rate * 100) / 100,
        total: Math.round(net * (1 + rate) * 100) / 100,
      }).eq("id", id);
      if (upErr) throw upErr;
      refresh();
      toast({ title: String(q?.status || "draft").toLowerCase() === "draft" ? "Saved as draft" : "Saved" });
    } catch (e: any) {
      toast({ title: "Could not save", description: e.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const handleSend = async () => {
    setBusy("send");
    try {
      await flush();
      if (!await checkLabour()) return;
      await ensureQuoteReadyToSend(id);
      qc.invalidateQueries({ queryKey: ["quote-document", id] });
      qc.invalidateQueries({ queryKey: ["quotes"] });
      setSendOpen(true);
    } catch (e: any) {
      toast({ title: "Could not prepare quote for sending", description: e.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const handlePdf = async () => {
    await flush();
    if (!await checkLabour()) return "Remember labour before generating the PDF.";
    setBusy("pdf");
    try {
      const { data: q, error } = await supabase.from("quotes").select("*, customers(name, address, email)").eq("id", id).maybeSingle();
      if (error || !q) throw error || new Error("Quote not found");
      const c: any = (q as any).customers || {};
      const items = await buildQuoteLineItems(id, (q as any).visual_sections);
      setClientPdf(true);
      const extras = await loadQuoteBrochuresForPdf(id);
      const captureSelector = await waitForClientPdfRoot(id);
      const pdfOpts = {
        ...extras,
        docType: "Quote",
        docNumber: q.quote_number || "DRAFT",
        companyName: settings.company_name || "0800-BE-COOL",
        companyAddress: settings.physical_address,
        vatNumber: settings.vat_number,
        customerName: c.name || q.customer_name || "Customer",
        customerAddress: c.address || undefined,
        customerEmail: c.email || undefined,
        issueDate: q.created_at,
        lineItems: items,
        subtotal: Number(q.subtotal) || 0,
        taxRate: Number(q.vat_rate) || 0.15,
        taxAmount: Number(q.vat_amount) || 0,
        total: Number(q.total) || 0,
        notes: q.notes || undefined,
        captureSelector,
      };
      if (isPhoneViewport()) {
        // Phones: show the PDF inside the app (with Back/Save/Share/Download/Home), not a bare browser tab.
        const blob = await generateDocumentPdfBlob(pdfOpts as any);
        const num = q.quote_number || "DRAFT";
        setPdfView({ url: URL.createObjectURL(blob), fileName: `Quote-${num}.pdf`, title: `Quote ${num}` });
      } else {
        await generateDocumentPdf(pdfOpts as any);
      }
    } catch (e: any) {
      toast({ title: "PDF failed", description: e?.message, variant: "destructive" });
    } finally {
      setClientPdf(false);
      setBusy(null);
    }
  };

  const handlePrint = async () => { await flush(); if (await checkLabour()) window.print(); };

  const scrollToLabour = (areaId: string) => {
    setMissingLabour([]);
    window.setTimeout(() => document.getElementById(`area-labour-${areaId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  };

  const portals: ReactNode = id ? (
    <>
      {clientPdf && <ClientQuotePdfRoot quoteId={id} />}
      {pdfView && (
        <QuotePdfViewer {...pdfView} busySave={busy === "save"} onBack={closePdfView}
          onSave={() => void handleSave()} onShare={() => { closePdfView(); void handleSend(); }} />
      )}
      <SendQuoteDialog open={sendOpen} onOpenChange={setSendOpen} quoteId={id} quoteNumber={quote?.quote_number || "Draft"} customerId={quote?.customer_id ?? null} customerName={customer.name || quote?.customer_name || "Customer"} />
      <Dialog open={missingLabour.length > 0} onOpenChange={(open) => { if (!open) setMissingLabour([]); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Labour missing</DialogTitle><DialogDescription>Add labour to every populated area before continuing.</DialogDescription></DialogHeader>
          <div className="space-y-1">
            {missingLabour.map((area) => <Button key={area.id} type="button" variant="ghost" className="w-full justify-start" onClick={() => scrollToLabour(area.id)}>{area.id === "job" ? "Job labour" : area.name}</Button>)}
          </div>
        </DialogContent>
      </Dialog>
    </>
  ) : null;

  return { quote, busy, checkLabour, handleSave, handleSend, handlePdf, handlePrint, scrollToLabour, portals };
}
