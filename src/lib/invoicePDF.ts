import { supabase } from "@/integrations/supabase/client";
import { generateDocumentPdf, generateDocumentPdfBlob } from "./documentPdf";

interface InvoiceLineItem {
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
}

interface InvoiceData {
  id: string;
  invoice_number: string;
  customer_name: string;
  customer_phone?: string | null;
  customer_email?: string | null;
  customer_address?: string | null;
  issue_date?: string;
  due_date?: string | null;
  status: string;
  line_items: InvoiceLineItem[];
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  grand_total: number;
  payment_method?: string | null;
  notes?: string | null;
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(amount);

const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });

/**
 * Builds the shared `documentPdf` capture options for an invoice. The actual
 * visuals (logo, company name, colours, banking details) come from whatever
 * is currently rendered on screen via <InvoiceDocument data-pdf-capture-root="invoice">,
 * so this always matches the branded, on-screen invoice instead of drawing a
 * separate, generic-looking PDF from scratch.
 */
const toDocumentPdfOptions = (invoice: InvoiceData) => ({
  docType: "Invoice" as const,
  docNumber: invoice.invoice_number,
  companyName: "",
  customerName: invoice.customer_name,
  customerAddress: invoice.customer_address || undefined,
  customerEmail: invoice.customer_email || undefined,
  issueDate: invoice.issue_date || new Date().toISOString(),
  dueDate: invoice.due_date || undefined,
  lineItems: invoice.line_items.map((i) => ({
    description: i.description,
    quantity: i.quantity,
    rate: i.unit_price,
    amount: i.amount,
  })),
  subtotal: invoice.subtotal,
  taxRate: invoice.tax_rate,
  taxAmount: invoice.tax_amount,
  total: invoice.grand_total,
  notes: invoice.notes || undefined,
  captureSelector: '[data-pdf-capture-root="invoice"]',
});

export const downloadInvoicePDF = async (invoice: InvoiceData) => {
  await generateDocumentPdf(toDocumentPdfOptions(invoice));
};

export const generateAndUploadPDF = async (invoice: InvoiceData): Promise<string | null> => {
  try {
    const pdfBlob = await generateDocumentPdfBlob(toDocumentPdfOptions(invoice));
    const fileName = `invoices/${invoice.invoice_number.replace(/[^a-zA-Z0-9-]/g, "_")}.pdf`;

    // Upload to Supabase storage
    const { error: uploadError } = await supabase.storage
      .from("job-photos") // Reuse existing bucket
      .upload(fileName, pdfBlob, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadError) {
      console.error("PDF upload error:", uploadError);
      return null;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from("job-photos")
      .getPublicUrl(fileName);

    // Update invoice with pdf_url
    await supabase
      .from("invoices")
      .update({ pdf_url: urlData.publicUrl } as any)
      .eq("id", invoice.id);

    return urlData.publicUrl;
  } catch (error) {
    console.error("PDF generation error:", error);
    return null;
  }
};

export const shareInvoice = async (invoice: InvoiceData, pdfUrl?: string | null) => {
  const text = `Invoice ${invoice.invoice_number}\nClient: ${invoice.customer_name}\nAmount: ${formatCurrency(invoice.grand_total)}\nStatus: ${invoice.status}`;

  // Try native share API (works on mobile / Capacitor)
  if (navigator.share) {
    const shareData: ShareData = {
      title: `Invoice ${invoice.invoice_number}`,
      text,
    };
    if (pdfUrl) {
      shareData.url = pdfUrl;
    }
    try {
      await navigator.share(shareData);
      return true;
    } catch {
      // User cancelled or not supported
    }
  }

  // Fallback: copy to clipboard
  await navigator.clipboard.writeText(pdfUrl ? `${text}\n\nView: ${pdfUrl}` : text);
  return false;
};

export const sendViaWhatsApp = (invoice: InvoiceData, pdfUrl?: string | null) => {
  if (!invoice.customer_phone) return;
  const phone = invoice.customer_phone.replace(/\D/g, "");
  const message = encodeURIComponent(
    `Hi ${invoice.customer_name},\n\nPlease find your invoice:\n\n📋 ${invoice.invoice_number}\n💰 Amount: ${formatCurrency(invoice.grand_total)}\n📅 Due: ${invoice.due_date ? formatDate(invoice.due_date) : "On receipt"}\n\n${pdfUrl ? `View PDF: ${pdfUrl}\n\n` : ""}Thank you for your business! 🙏`
  );
  window.open(`https://wa.me/${phone}?text=${message}`, "_blank");
};
