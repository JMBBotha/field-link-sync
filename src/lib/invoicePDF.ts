import jsPDF from "jspdf";
import { supabase } from "@/integrations/supabase/client";

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

export const generateInvoicePDF = (invoice: InvoiceData): jsPDF => {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = 25;

  // ── Company Header ──
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 119, 182);
  doc.text("BE COOL AC SUPER SERVICE", margin, y);
  y += 5;
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100);
  doc.text("0800-BE-COOL (0800 23 2665) | VAT No: 4123456789", margin, y);
  y += 4;
  doc.text("info@becool.co.za | www.becool.co.za", margin, y);
  y += 10;

  // ── Invoice Title ──
  doc.setFontSize(24);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 119, 182);
  doc.text("TAX INVOICE", margin, y);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100);
  doc.text(invoice.invoice_number, pageWidth - margin, y, { align: "right" });
  y += 8;
  doc.text(`Date: ${formatDate(invoice.issue_date || new Date().toISOString())}`, pageWidth - margin, y, { align: "right" });
  if (invoice.due_date) {
    y += 5;
    doc.text(`Due: ${formatDate(invoice.due_date)}`, pageWidth - margin, y, { align: "right" });
  }

  // ── Status Badge ──
  y += 3;
  const statusColors: Record<string, [number, number, number]> = {
    draft: [156, 163, 175],
    sent: [59, 130, 246],
    paid: [34, 197, 94],
    overdue: [239, 68, 68],
  };
  const badgeColor = statusColors[invoice.status] || [156, 163, 175];
  const statusText = invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1);
  const badgeWidth = doc.getTextWidth(statusText) + 10;
  doc.setFillColor(...badgeColor);
  doc.roundedRect(pageWidth - margin - badgeWidth, y - 4, badgeWidth, 7, 2, 2, "F");
  doc.setFontSize(8);
  doc.setTextColor(255);
  doc.text(statusText, pageWidth - margin - badgeWidth / 2, y, { align: "center" });

  // ── Divider ──
  y += 12;
  doc.setDrawColor(230);
  doc.line(margin, y, pageWidth - margin, y);
  y += 10;

  // ── Bill To ──
  doc.setFontSize(9);
  doc.setTextColor(150);
  doc.setFont("helvetica", "bold");
  doc.text("BILL TO", margin, y);
  y += 6;
  doc.setFontSize(12);
  doc.setTextColor(30);
  doc.text(invoice.customer_name, margin, y);
  y += 5;
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.setFont("helvetica", "normal");
  if (invoice.customer_phone) { doc.text(invoice.customer_phone, margin, y); y += 4; }
  if (invoice.customer_email) { doc.text(invoice.customer_email, margin, y); y += 4; }
  if (invoice.customer_address) { doc.text(invoice.customer_address, margin, y); y += 4; }
  y += 8;

  // ── Line Items Table ──
  // Table header
  doc.setFillColor(245, 247, 250);
  doc.rect(margin, y - 4, contentWidth, 8, "F");
  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.setFont("helvetica", "bold");
  doc.text("DESCRIPTION", margin + 3, y);
  doc.text("QTY", margin + contentWidth * 0.55, y, { align: "center" });
  doc.text("RATE", margin + contentWidth * 0.72, y, { align: "right" });
  doc.text("AMOUNT", pageWidth - margin - 3, y, { align: "right" });
  y += 8;

  // Table rows
  doc.setFont("helvetica", "normal");
  doc.setTextColor(50);
  doc.setFontSize(9);
  invoice.line_items.forEach((item) => {
    if (y > 250) {
      doc.addPage();
      y = 25;
    }
    doc.text(item.description.substring(0, 40), margin + 3, y);
    doc.text(String(item.quantity), margin + contentWidth * 0.55, y, { align: "center" });
    doc.text(formatCurrency(item.unit_price), margin + contentWidth * 0.72, y, { align: "right" });
    doc.text(formatCurrency(item.amount), pageWidth - margin - 3, y, { align: "right" });
    y += 6;
    doc.setDrawColor(240);
    doc.line(margin, y - 2, pageWidth - margin, y - 2);
  });

  y += 6;

  // ── Totals ──
  const totalsX = pageWidth - margin - 70;
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text("Subtotal", totalsX, y);
  doc.text(formatCurrency(invoice.subtotal), pageWidth - margin - 3, y, { align: "right" });
  y += 6;
  doc.text(`VAT (${invoice.tax_rate}%)`, totalsX, y);
  doc.text(formatCurrency(invoice.tax_amount), pageWidth - margin - 3, y, { align: "right" });
  y += 3;
  doc.setDrawColor(200);
  doc.line(totalsX, y, pageWidth - margin, y);
  y += 6;
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 119, 182);
  doc.text("TOTAL", totalsX, y);
  doc.text(formatCurrency(invoice.grand_total), pageWidth - margin - 3, y, { align: "right" });

  // ── Payment Method ──
  if (invoice.payment_method) {
    y += 14;
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.setFont("helvetica", "bold");
    doc.text("PAYMENT METHOD", margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80);
    doc.setFontSize(9);
    doc.text(invoice.payment_method.charAt(0).toUpperCase() + invoice.payment_method.slice(1), margin, y);
  }

  // ── Notes ──
  if (invoice.notes) {
    y += 14;
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.setFont("helvetica", "bold");
    doc.text("NOTES", margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80);
    doc.setFontSize(9);
    const splitNotes = doc.splitTextToSize(invoice.notes, contentWidth);
    doc.text(splitNotes, margin, y);
  }

  // ── Banking Details ──
  y += 14;
  if (y > 245) { doc.addPage(); y = 25; }
  doc.setFillColor(245, 247, 250);
  doc.rect(margin, y - 4, contentWidth, 30, "F");
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 119, 182);
  doc.text("BANKING DETAILS", margin + 4, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(80);
  doc.setFontSize(7.5);
  doc.text("Bank: First National Bank (FNB)", margin + 4, y); y += 4;
  doc.text("Account: Be Cool AC Super Service (Pty) Ltd", margin + 4, y); y += 4;
  doc.text("Account No: 62876543210 | Branch Code: 250655", margin + 4, y); y += 4;
  doc.text("Reference: " + invoice.invoice_number, margin + 4, y);

  // ── Footer ──
  const footerY = doc.internal.pageSize.getHeight() - 12;
  doc.setFontSize(7);
  doc.setTextColor(180);
  doc.text("Be Cool AC Super Service (Pty) Ltd | Reg No: 2024/123456/07 | SARS-compliant Tax Invoice", pageWidth / 2, footerY, { align: "center" });

  return doc;
};

export const generateAndUploadPDF = async (invoice: InvoiceData): Promise<string | null> => {
  try {
    const doc = generateInvoicePDF(invoice);
    const pdfBlob = doc.output("blob");
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

export const downloadInvoicePDF = (invoice: InvoiceData) => {
  const doc = generateInvoicePDF(invoice);
  doc.save(`${invoice.invoice_number}.pdf`);
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
