import jsPDF from "jspdf";
import { assembleQuoteWithBrochures } from "./pdfMerger";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

interface DocumentPdfOptions {
  docType: "Invoice" | "Quote" | "Proposal";
  docNumber: string;
  companyName: string;
  companyAddress?: string;
  vatNumber?: string;
  customerName: string;
  customerAddress?: string;
  customerEmail?: string;
  issueDate: string;
  dueDate?: string;
  lineItems: { description: string; quantity: number; rate: number; markup?: number; amount: number }[];
  subtotal: number;
  discountAmount?: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  notes?: string;
  terms?: string;
  brochureUrls?: string[];
}

export async function generateDocumentPdf(opts: DocumentPdfOptions) {
  const doc = new jsPDF();
  const pw = doc.internal.pageSize.getWidth();
  let y = 15;

  // Yellow accent stripe
  doc.setFillColor(245, 158, 11);
  doc.rect(0, 0, pw, 6, "F");

  // Logo text
  y = 20;
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(33, 33, 33);
  doc.text("0800", 14, y);
  doc.setTextColor(37, 99, 235);
  doc.text("BeCool", 14 + doc.getTextWidth("0800") + 1, y);

  // Company info
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  y += 7;
  doc.text(opts.companyName, 14, y);
  if (opts.companyAddress) { y += 4; doc.text(opts.companyAddress, 14, y); }
  if (opts.vatNumber) { y += 4; doc.text(`VAT: ${opts.vatNumber}`, 14, y); }

  // Doc type + number on right
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(33, 33, 33);
  doc.text(`${opts.docType} ${opts.docNumber}`, pw - 14, 20, { align: "right" });
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 100, 100);
  doc.text(`Date: ${opts.issueDate}`, pw - 14, 27, { align: "right" });
  if (opts.dueDate) doc.text(`Due: ${opts.dueDate}`, pw - 14, 31, { align: "right" });

  // Billed To
  y += 10;
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text("BILLED TO", 14, y);
  y += 5;
  doc.setFontSize(10);
  doc.setTextColor(33, 33, 33);
  doc.setFont("helvetica", "bold");
  doc.text(opts.customerName, 14, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  if (opts.customerAddress) { y += 5; doc.text(opts.customerAddress, 14, y); }
  if (opts.customerEmail) { y += 4; doc.text(opts.customerEmail, 14, y); }

  // Line items table header
  y += 12;
  doc.setFillColor(245, 245, 245);
  doc.rect(14, y - 4, pw - 28, 8, "F");
  doc.setFontSize(8);
  doc.setTextColor(80, 80, 80);
  doc.setFont("helvetica", "bold");
  doc.text("Description", 16, y);
  doc.text("Rate", 120, y, { align: "right" });
  doc.text("Qty", 138, y, { align: "right" });
  if (opts.lineItems.some(i => i.markup)) doc.text("Markup", 155, y, { align: "right" });
  doc.text("Total", pw - 16, y, { align: "right" });

  // Items
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(33, 33, 33);
  y += 6;
  for (const item of opts.lineItems) {
    if (y > 270) { doc.addPage(); y = 20; }
    doc.text(item.description.substring(0, 55), 16, y);
    doc.text(fmt(item.rate), 120, y, { align: "right" });
    doc.text(String(item.quantity), 138, y, { align: "right" });
    if (item.markup) doc.text(`${item.markup}%`, 155, y, { align: "right" });
    doc.text(fmt(item.amount), pw - 16, y, { align: "right" });
    y += 6;
  }

  // Divider
  y += 2;
  doc.setDrawColor(200, 200, 200);
  doc.line(100, y, pw - 14, y);
  y += 6;

  // Totals
  const totalsX = pw - 16;
  const labelsX = 110;
  doc.setFontSize(9);
  doc.text("Subtotal", labelsX, y);
  doc.text(fmt(opts.subtotal), totalsX, y, { align: "right" });
  y += 5;
  if (opts.discountAmount && opts.discountAmount > 0) {
    doc.text("Discount", labelsX, y);
    doc.text(`-${fmt(opts.discountAmount)}`, totalsX, y, { align: "right" });
    y += 5;
  }
  doc.text(`VAT (${opts.taxRate}%)`, labelsX, y);
  doc.text(fmt(opts.taxAmount), totalsX, y, { align: "right" });
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setFillColor(245, 158, 11);
  doc.rect(labelsX - 2, y - 5, pw - labelsX - 12, 9, "F");
  doc.setTextColor(255, 255, 255);
  doc.text("Total (ZAR)", labelsX, y);
  doc.text(fmt(opts.total), totalsX, y, { align: "right" });

  // Notes / Terms
  doc.setTextColor(33, 33, 33);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  y += 14;
  if (opts.notes) {
    doc.setFont("helvetica", "bold");
    doc.text("Notes", 14, y);
    doc.setFont("helvetica", "normal");
    y += 4;
    const lines = doc.splitTextToSize(opts.notes, pw - 28);
    doc.text(lines, 14, y);
    y += lines.length * 4 + 4;
  }
  if (opts.terms) {
    doc.setFont("helvetica", "bold");
    doc.text("Terms", 14, y);
    doc.setFont("helvetica", "normal");
    y += 4;
    const lines = doc.splitTextToSize(opts.terms, pw - 28);
    doc.text(lines, 14, y);
  }

  doc.save(`${opts.docType}-${opts.docNumber}.pdf`);
}
