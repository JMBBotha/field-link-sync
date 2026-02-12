import jsPDF from "jspdf";
import type { Basket } from "@/components/catalog/QuoteBuilderTab";

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(amount);

export const generateQuoteBuilderPDF = (baskets: Basket[], quoteName: string) => {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = 20;

  // Header
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 119, 182);
  doc.text("BE COOL AC SUPER SERVICE", margin, y);
  y += 7;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100);
  doc.text("0800-BE-COOL (0800 23 2665) | info@becool.co.za", margin, y);

  // Title
  y += 12;
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30);
  doc.text(quoteName, margin, y);
  y += 6;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100);
  doc.text(`Date: ${new Date().toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })}`, margin, y);

  y += 8;
  doc.setDrawColor(0, 119, 182);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  let grandTotal = 0;

  baskets.forEach((basket) => {
    if (basket.items.length === 0) return;
    if (y > 240) { doc.addPage(); y = 25; }

    // Zone header
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 119, 182);
    doc.text(basket.name, margin, y);
    y += 6;

    // Table header
    doc.setFillColor(0, 119, 182);
    doc.rect(margin, y - 4, contentWidth, 7, "F");
    doc.setFontSize(8);
    doc.setTextColor(255);
    doc.setFont("helvetica", "bold");
    doc.text("PRODUCT", margin + 3, y);
    doc.text("QTY", margin + contentWidth * 0.6, y, { align: "center" });
    doc.text("UNIT PRICE", margin + contentWidth * 0.78, y, { align: "right" });
    doc.text("TOTAL", pageWidth - margin - 3, y, { align: "right" });
    y += 7;

    doc.setFont("helvetica", "normal");
    doc.setTextColor(50);
    doc.setFontSize(9);

    let zoneTotal = 0;
    basket.items.forEach((item, idx) => {
      if (y > 260) { doc.addPage(); y = 25; }
      const price = item.product.selling_price || item.product.cost_incl_vat || 0;
      const lineTotal = price * item.quantity;
      zoneTotal += lineTotal;

      const bgColor = idx % 2 === 0 ? 250 : 245;
      doc.setFillColor(bgColor, bgColor, bgColor);
      doc.rect(margin, y - 4, contentWidth, 7, "F");

      const name = `${item.product.brand || ""} ${item.product.short_name || item.product.product_code}`.trim();
      doc.text(name.substring(0, 50), margin + 3, y);
      doc.text(String(item.quantity), margin + contentWidth * 0.6, y, { align: "center" });
      doc.text(formatCurrency(price), margin + contentWidth * 0.78, y, { align: "right" });
      doc.text(formatCurrency(lineTotal), pageWidth - margin - 3, y, { align: "right" });
      y += 7;
    });

    // Zone subtotal
    doc.setFont("helvetica", "bold");
    doc.setTextColor(80);
    doc.text(`Zone Subtotal:`, margin + contentWidth * 0.5, y);
    doc.text(formatCurrency(zoneTotal), pageWidth - margin - 3, y, { align: "right" });
    y += 10;

    grandTotal += zoneTotal;
  });

  // Grand total
  y += 4;
  if (y > 250) { doc.addPage(); y = 25; }
  doc.setDrawColor(0, 119, 182);
  doc.setLineWidth(0.5);
  doc.line(margin + contentWidth * 0.5, y, pageWidth - margin, y);
  y += 7;

  const subtotal = grandTotal / 1.15;
  const vat = grandTotal - subtotal;

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100);
  const totalsX = margin + contentWidth * 0.5;
  doc.text("Subtotal (excl. VAT)", totalsX, y);
  doc.text(formatCurrency(subtotal), pageWidth - margin - 3, y, { align: "right" });
  y += 5;
  doc.text("VAT (15%)", totalsX, y);
  doc.text(formatCurrency(vat), pageWidth - margin - 3, y, { align: "right" });
  y += 6;

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 119, 182);
  doc.text("TOTAL (incl. VAT)", totalsX, y);
  doc.text(formatCurrency(grandTotal), pageWidth - margin - 3, y, { align: "right" });

  // Footer
  const footerY = doc.internal.pageSize.getHeight() - 12;
  doc.setFontSize(7);
  doc.setTextColor(180);
  doc.text("Be Cool AC Super Service (Pty) Ltd | Reg No: 2024/123456/07", pageWidth / 2, footerY, { align: "center" });

  doc.save(`${quoteName.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`);
};
