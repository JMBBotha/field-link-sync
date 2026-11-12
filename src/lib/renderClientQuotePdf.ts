import { supabase } from "@/integrations/supabase/client";
import { buildQuoteLineItems } from "@/lib/convertQuoteToInvoice";
import { generateDocumentPdfBlob } from "@/lib/documentPdf";
import { loadQuoteBrochuresForPdf } from "@/lib/quoteBrochuresForPdf";
import { clientBrochureSelector, waitForClientPdfRoot } from "@/components/quoting/ClientQuotePdfRoot";

/**
 * The quote PDF the Download PDF button builds: off-screen client document
 * (letterhead included) plus the standard terms page. The caller must already
 * have mounted <ClientQuotePdfRoot quoteId={quoteId} />. Reads only — no status,
 * send, or pdf_activity write.
 */
export async function renderClientQuotePdfBlob(opts: {
  quoteId: string;
  companyName?: string | null;
  companyAddress?: string | null;
  vatNumber?: string | null;
  onWarning?: (message: string) => void;
}): Promise<{ blob: Blob; quoteNumber: string }> {
  const { data: q, error } = await supabase.from("quotes").select("*, customers(name, address, email)").eq("id", opts.quoteId).maybeSingle();
  if (error || !q) throw error || new Error("Quote not found");
  const c: { name?: string | null; address?: string | null; email?: string | null } = (q as { customers?: { name?: string | null; address?: string | null; email?: string | null } | null }).customers || {};
  const items = await buildQuoteLineItems(opts.quoteId, (q as { visual_sections?: unknown }).visual_sections);
  const extras = await loadQuoteBrochuresForPdf(opts.quoteId);
  const captureSelector = await waitForClientPdfRoot(opts.quoteId);
  const quoteNumber = q.quote_number || "DRAFT";
  const blob = await generateDocumentPdfBlob({
    ...extras,
    docType: "Quote",
    docNumber: quoteNumber,
    companyName: opts.companyName || "0800-BE-COOL",
    companyAddress: opts.companyAddress || undefined,
    vatNumber: opts.vatNumber || undefined,
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
    extraPageSelector: clientBrochureSelector(opts.quoteId),
    onWarning: opts.onWarning,
  } as Parameters<typeof generateDocumentPdfBlob>[0]);
  return { blob, quoteNumber };
}
