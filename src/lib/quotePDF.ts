import jsPDF from "jspdf";
import { assembleQuoteWithBrochures, type BrochureAttachment } from "./pdfMerger";

interface QuoteLineItem {
  description: string;
  quantity: number;
  unit_price: number;
}

interface QuoteData {
  quote_number: string;
  customer_name: string;
  customer_phone?: string | null;
  customer_email?: string | null;
  customer_address?: string | null;
  valid_until?: string | null;
  notes?: string | null;
  line_items: QuoteLineItem[];
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  status: string;
  created_at: string;
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(amount);

const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });

export const generateQuotePDF = (quote: QuoteData): jsPDF => {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = 20;

  // ── Company Header ──
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 119, 182);
  doc.text("BE COOL AC SUPER SERVICE", margin, y);
  y += 7;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100);
  doc.text("0800-BE-COOL (0800 23 2665)", margin, y);
  y += 4;
  doc.text("VAT No: 4123456789", margin, y);
  y += 4;
  doc.text("info@becool.co.za | www.becool.co.za", margin, y);

  // ── Quote Title ──
  y += 12;
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 119, 182);
  doc.text("QUOTATION", pageWidth - margin, y, { align: "right" });
  y += 8;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(80);
  doc.text(quote.quote_number, pageWidth - margin, y, { align: "right" });
  y += 5;
  doc.text(`Date: ${formatDate(quote.created_at)}`, pageWidth - margin, y, { align: "right" });
  if (quote.valid_until) {
    y += 5;
    doc.text(`Valid Until: ${formatDate(quote.valid_until)}`, pageWidth - margin, y, { align: "right" });
  }

  // ── Divider ──
  y += 8;
  doc.setDrawColor(0, 119, 182);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 10;

  // ── Client Details ──
  doc.setFontSize(9);
  doc.setTextColor(150);
  doc.setFont("helvetica", "bold");
  doc.text("QUOTATION FOR", margin, y);
  y += 6;
  doc.setFontSize(12);
  doc.setTextColor(30);
  doc.text(quote.customer_name, margin, y);
  y += 5;
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.setFont("helvetica", "normal");
  if (quote.customer_phone) { doc.text(quote.customer_phone, margin, y); y += 4; }
  if (quote.customer_email) { doc.text(quote.customer_email, margin, y); y += 4; }
  if (quote.customer_address) { doc.text(quote.customer_address, margin, y); y += 4; }
  y += 8;

  // ── Line Items Table ──
  doc.setFillColor(0, 119, 182);
  doc.rect(margin, y - 4, contentWidth, 8, "F");
  doc.setFontSize(8);
  doc.setTextColor(255);
  doc.setFont("helvetica", "bold");
  doc.text("DESCRIPTION", margin + 3, y);
  doc.text("QTY", margin + contentWidth * 0.55, y, { align: "center" });
  doc.text("UNIT PRICE", margin + contentWidth * 0.75, y, { align: "right" });
  doc.text("TOTAL", pageWidth - margin - 3, y, { align: "right" });
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setTextColor(50);
  doc.setFontSize(9);
  
  quote.line_items.forEach((item, idx) => {
    if (y > 240) { doc.addPage(); y = 25; }
    const lineTotal = item.quantity * item.unit_price;
    const bgColor = idx % 2 === 0 ? 250 : 245;
    doc.setFillColor(bgColor, bgColor, bgColor);
    doc.rect(margin, y - 4, contentWidth, 7, "F");
    doc.text(item.description.substring(0, 45), margin + 3, y);
    doc.text(String(item.quantity), margin + contentWidth * 0.55, y, { align: "center" });
    doc.text(formatCurrency(item.unit_price), margin + contentWidth * 0.75, y, { align: "right" });
    doc.text(formatCurrency(lineTotal), pageWidth - margin - 3, y, { align: "right" });
    y += 7;
  });

  y += 6;

  // ── Totals ──
  const totalsX = pageWidth - margin - 80;
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text("Subtotal (excl. VAT)", totalsX, y);
  doc.text(formatCurrency(quote.subtotal), pageWidth - margin - 3, y, { align: "right" });
  y += 6;
  doc.text(`VAT (${(quote.vat_rate * 100).toFixed(0)}%)`, totalsX, y);
  doc.text(formatCurrency(quote.vat_amount), pageWidth - margin - 3, y, { align: "right" });
  y += 4;
  doc.setDrawColor(0, 119, 182);
  doc.setLineWidth(0.5);
  doc.line(totalsX, y, pageWidth - margin, y);
  y += 7;
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 119, 182);
  doc.text("TOTAL (incl. VAT)", totalsX, y);
  doc.text(formatCurrency(quote.total), pageWidth - margin - 3, y, { align: "right" });

  // ── Notes ──
  if (quote.notes) {
    y += 14;
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.setFont("helvetica", "bold");
    doc.text("NOTES", margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80);
    doc.setFontSize(9);
    const splitNotes = doc.splitTextToSize(quote.notes, contentWidth);
    doc.text(splitNotes, margin, y);
    y += splitNotes.length * 4 + 4;
  }

  // ── Terms & Conditions ──
  y = Math.max(y + 10, 220);
  if (y > 250) { doc.addPage(); y = 25; }
  doc.setDrawColor(230);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(100);
  doc.text("TERMS & CONDITIONS", margin, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(130);
  const terms = [
    "1. This quotation is valid for 30 days from the date of issue.",
    "2. A 50% deposit is required upon acceptance to commence work.",
    "3. Balance due upon completion of work.",
    "4. All prices include 15% VAT as per South African law.",
    "5. Warranty: 12 months on parts, 90 days on labour.",
    "6. Payment terms: EFT, cash, or card on site.",
  ];
  terms.forEach(term => {
    doc.text(term, margin, y);
    y += 4;
  });

  // ── Footer ──
  const footerY = doc.internal.pageSize.getHeight() - 12;
  doc.setFontSize(7);
  doc.setTextColor(180);
  doc.text("Be Cool AC Super Service (Pty) Ltd | Reg No: 2024/123456/07", pageWidth / 2, footerY, { align: "center" });

  return doc;
};

export const downloadQuotePDF = async (quote: QuoteData, brochureUrls?: string[]) => {
  const doc = generateQuotePDF(quote);
  if (brochureUrls && brochureUrls.length > 0) {
    const quoteBytes = doc.output("arraybuffer");
    const merged = await assembleQuoteWithBrochures(new Uint8Array(quoteBytes), brochureUrls);
    const blob = new Blob([new Uint8Array(merged)], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${quote.quote_number}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } else {
    doc.save(`${quote.quote_number}.pdf`);
  }
};
