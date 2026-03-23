import jsPDF from "jspdf";
import { assembleQuoteWithBrochures, type BrochureAttachment } from "./pdfMerger";
import logoAssetUrl from "@/assets/logo.png";
import { EMBEDDED_LOGO_DATA_URL } from "./embeddedLogoDataUrl";

/* ─── South African Rand formatter ─── */
const fmtZAR = (n: number): string => {
  const parts = n.toFixed(2).split(".");
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `R ${intPart},${parts[1]}`;
};

/* ─── Brand colours (HSL converted to RGB for jsPDF) ─── */
const BLUE = { r: 0, g: 119, b: 182 };          // #0077B6 – primary brand
const BLUE_DARK = { r: 30, g: 58, b: 95 };      // #1E3A5F – sidebar/nav navy
const AMBER = { r: 245, g: 158, b: 11 };        // #F59E0B – total row accent only
const GRAY_LIGHT = { r: 248, g: 248, b: 248 };
const GRAY_MID = { r: 120, g: 120, b: 120 };
const DARK = { r: 33, g: 33, b: 33 };
const WHITE = { r: 255, g: 255, b: 255 };

interface DocumentPdfOptions {
  docType: "Invoice" | "Quote" | "Proposal";
  docNumber: string;
  companyName: string;
  companyAddress?: string;
  vatNumber?: string;
  logoUrl?: string | null;
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
  reference?: string;
  brochures?: BrochureAttachment[];
}

/* ─── Helper: set colour from object ─── */
function setFill(doc: jsPDF, c: { r: number; g: number; b: number }) {
  doc.setFillColor(c.r, c.g, c.b);
}
function setTxt(doc: jsPDF, c: { r: number; g: number; b: number }) {
  doc.setTextColor(c.r, c.g, c.b);
}

export async function generateDocumentPdf(opts: DocumentPdfOptions) {
  const doc = new jsPDF();
  const pw = doc.internal.pageSize.getWidth();   // 210
  const ph = doc.internal.pageSize.getHeight();   // 297
  const ml = 14;   // left margin
  const mr = 14;   // right margin
  const cw = pw - ml - mr;                       // content width
  let y = 0;

  /* ═══════════════════════════════════════════════
   *  1. BLUE GRADIENT BANNER (top stripe)
   * ═══════════════════════════════════════════════ */
  setFill(doc, BLUE_DARK);
  doc.rect(0, 0, pw, 7, "F");
  // Lighter blue-grey bar just below
  setFill(doc, BLUE);
  doc.rect(0, 7, pw, 2, "F");
  // Subtle grey fade
  setFill(doc, { r: 220, g: 225, b: 235 });
  doc.rect(0, 9, pw, 1, "F");
  y = 18;

  /* ═══════════════════════════════════════════════
   *  2. HEADER: Logo left + Company info right
   * ═══════════════════════════════════════════════ */
  const logoWmm = 50;
  const logoHmm = 50 / 2.67; // aspect ratio of logo.png (842×316)
  let logoLoaded = false;

  // 1) Try exact same URL strategy used by QuoteBuilder UI (company logo URL)
  // 2) Fallback to local asset absolute URL
  // 3) Final fallback: embedded base64 logo (always works)
  try {
    const resolvedAssetUrl = new URL(logoAssetUrl, window.location.origin).href;
    const preferredLogoUrl = opts.logoUrl ? new URL(opts.logoUrl, window.location.origin).href : resolvedAssetUrl;

    console.log("[PDF] Preferred logo URL:", preferredLogoUrl);

    const img = new Image();
    img.crossOrigin = "anonymous";
    const loaded = await new Promise<boolean>((resolve) => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = preferredLogoUrl;
    });

    if (loaded) {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL("image/png");
        doc.addImage(dataUrl, "PNG", ml, y - 4, logoWmm, logoHmm);
        logoLoaded = true;
        console.log("[PDF] Logo embedded from URL successfully");
      }
    } else {
      console.warn("[PDF] URL logo failed to load:", preferredLogoUrl);
    }
  } catch (e) {
    console.warn("[PDF] URL logo pipeline failed:", e);
  }

  if (!logoLoaded) {
    try {
      doc.addImage(EMBEDDED_LOGO_DATA_URL, "PNG", ml, y - 4, logoWmm, logoHmm);
      logoLoaded = true;
      console.log("[PDF] Embedded base64 logo used");
    } catch (e) {
      console.warn("[PDF] Embedded base64 logo failed:", e);
    }
  }

  if (!logoLoaded) {
    // Final text fallback (should almost never happen)
    doc.setFontSize(20);
    doc.setFont("helvetica", "bold");
    setTxt(doc, DARK);
    doc.text("0800", ml, y);
    setTxt(doc, BLUE);
    doc.text("BeCool", ml + doc.getTextWidth("0800") + 1.5, y);
  }

  // Right column: Company identity
  const rx = pw - mr;
  let ry = 14;
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  setTxt(doc, DARK);
  doc.text(`CT - ${opts.companyName || "0800-BE-COOL AC Super Service"}`, rx, ry, { align: "right" });
  ry += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setTxt(doc, GRAY_MID);
  if (opts.vatNumber) {
    doc.text(`VAT ${opts.vatNumber}`, rx, ry, { align: "right" });
    ry += 3.5;
  }
  // Address lines
  const addressLines = opts.companyAddress
    ? opts.companyAddress.split(",").map((s) => s.trim())
    : ["6 Aviation Cress", "Airport City", "Cape Town", "7100"];
  addressLines.forEach((line) => {
    doc.text(line, rx, ry, { align: "right" });
    ry += 3.5;
  });

  /* Divider line */
  y = Math.max(y, ry) + 4;
  doc.setDrawColor(BLUE_DARK.r, BLUE_DARK.g, BLUE_DARK.b);
  doc.setLineWidth(0.6);
  doc.line(ml, y, pw - mr, y);
  y += 8;

  /* ═══════════════════════════════════════════════
   *  3. QUOTE INFO – 4-column grid
   * ═══════════════════════════════════════════════ */
  const colW = cw / 4;
  const col1 = ml;
  const col2 = ml + colW;
  const col3 = ml + colW * 2;
  const col4 = ml + colW * 3;

  const labelStyle = () => {
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "bold");
    setTxt(doc, GRAY_MID);
  };
  const valueStyle = () => {
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    setTxt(doc, DARK);
  };

  // Row 1
  const row1y = y;
  labelStyle();
  doc.text("BILLED TO", col1, row1y);
  doc.text("DATE OF ISSUE", col2, row1y);
  doc.text(`${opts.docType.toUpperCase()} NUMBER`, col3, row1y);
  doc.text("QUOTED AMOUNT (ZAR)", col4, row1y);

  // Values
  const valY = row1y + 5;
  valueStyle();
  doc.text(opts.customerName || "—", col1, valY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setTxt(doc, GRAY_MID);
  if (opts.customerAddress) {
    const addrLines = doc.splitTextToSize(opts.customerAddress, colW - 4);
    doc.text(addrLines, col1, valY + 4);
  }
  if (opts.customerEmail) {
    const emailY = valY + 4 + (opts.customerAddress ? doc.splitTextToSize(opts.customerAddress, colW - 4).length * 3.5 : 0);
    doc.text(opts.customerEmail, col1, emailY);
  }

  valueStyle();
  doc.text(opts.issueDate || "—", col2, valY);

  doc.text(opts.docNumber || "DRAFT", col3, valY);

  // Large blue total
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  setTxt(doc, BLUE);
  doc.text(fmtZAR(opts.total), col4, valY);

  // Row 2: Valid Until + Reference
  const row2y = valY + 12;
  labelStyle();
  doc.text("VALID UNTIL", col2, row2y);
  doc.text("REFERENCE / PO#", col3, row2y);
  valueStyle();
  doc.setFontSize(8);
  doc.text(opts.dueDate || "—", col2, row2y + 4);
  doc.text(opts.reference || "—", col3, row2y + 4);

  y = row2y + 12;

  /* Dark divider */
  doc.setDrawColor(BLUE_DARK.r, BLUE_DARK.g, BLUE_DARK.b);
  doc.setLineWidth(0.8);
  doc.line(ml, y, pw - mr, y);
  y += 8;

  /* ═══════════════════════════════════════════════
   *  4. LINE ITEMS TABLE
   * ═══════════════════════════════════════════════ */
  const hasMarkup = opts.lineItems.some((i) => i.markup && i.markup > 0);

  // Column positions
  const descX = ml + 2;
  const costX = ml + cw * 0.52;
  const qtyX = ml + cw * 0.62;
  const markupX = ml + cw * 0.73;
  const totalX = pw - mr - 2;

  // Header row
  setFill(doc, GRAY_LIGHT);
  doc.rect(ml, y - 4, cw, 7, "F");
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  setTxt(doc, GRAY_MID);
  doc.text("DESCRIPTION", descX, y);
  doc.text("COST", costX, y, { align: "right" });
  doc.text("QTY", qtyX, y, { align: "right" });
  if (hasMarkup) doc.text("MARKUP%", markupX, y, { align: "right" });
  doc.text("TOTAL", totalX, y, { align: "right" });
  y += 7;

  // Draw bottom border of header
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  doc.line(ml, y - 3, pw - mr, y - 3);

  // Rows
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "normal");
  setTxt(doc, DARK);

  opts.lineItems.forEach((item, idx) => {
    if (!item.description) return;
    if (y > ph - 45) { doc.addPage(); y = 20; }

    // Alternating background
    if (idx % 2 === 0) {
      setFill(doc, { r: 252, g: 252, b: 252 });
      doc.rect(ml, y - 3.5, cw, 7, "F");
    }

    // Description (truncate to fit)
    const maxDescW = (cw * 0.48) - 4;
    let desc = item.description;
    while (doc.getTextWidth(desc) > maxDescW && desc.length > 3) {
      desc = desc.slice(0, -1);
    }
    if (desc.length < item.description.length) desc += "…";

    setTxt(doc, DARK);
    doc.text(desc, descX, y);
    doc.text(fmtZAR(item.rate), costX, y, { align: "right" });
    doc.text(String(item.quantity), qtyX, y, { align: "right" });
    if (hasMarkup) {
      doc.text(item.markup ? `${item.markup}%` : "—", markupX, y, { align: "right" });
    }
    doc.setFont("helvetica", "bold");
    doc.text(fmtZAR(item.amount), totalX, y, { align: "right" });
    doc.setFont("helvetica", "normal");

    // Row separator
    y += 7;
    doc.setDrawColor(235, 235, 235);
    doc.setLineWidth(0.2);
    doc.line(ml, y - 3, pw - mr, y - 3);
  });

  y += 4;

  /* ═══════════════════════════════════════════════
   *  5. TOTALS SECTION
   * ═══════════════════════════════════════════════ */
  if (y > ph - 60) { doc.addPage(); y = 20; }

  const totalsLabelX = pw - mr - 80;

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  setTxt(doc, GRAY_MID);
  doc.text("Subtotal", totalsLabelX, y);
  setTxt(doc, DARK);
  doc.text(fmtZAR(opts.subtotal), totalX, y, { align: "right" });
  y += 5;

  if (opts.discountAmount && opts.discountAmount > 0) {
    setTxt(doc, GRAY_MID);
    doc.text("Discount", totalsLabelX, y);
    setTxt(doc, DARK);
    doc.text(`-${fmtZAR(opts.discountAmount)}`, totalX, y, { align: "right" });
    y += 5;
  }

  setTxt(doc, GRAY_MID);
  doc.text(`VAT (${opts.taxRate}%)`, totalsLabelX, y);
  setTxt(doc, DARK);
  doc.text(fmtZAR(opts.taxAmount), totalX, y, { align: "right" });
  y += 6;

  // Orange total bar
  const totalBarW = 90;
  const totalBarX = pw - mr - totalBarW;
  setFill(doc, AMBER);
  doc.roundedRect(totalBarX, y - 4.5, totalBarW, 10, 2, 2, "F");
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  setTxt(doc, WHITE);
  doc.text("Total (ZAR)", totalBarX + 4, y + 1.5);
  doc.text(fmtZAR(opts.total), pw - mr - 3, y + 1.5, { align: "right" });

  y += 18;

  /* ═══════════════════════════════════════════════
   *  6. NOTES
   * ═══════════════════════════════════════════════ */
  if (opts.notes) {
    if (y > ph - 40) { doc.addPage(); y = 20; }
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    setTxt(doc, GRAY_MID);
    doc.text("NOTES", ml, y);
    y += 4;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setTxt(doc, DARK);
    const noteLines = doc.splitTextToSize(opts.notes, cw);
    doc.text(noteLines, ml, y);
    y += noteLines.length * 3.5 + 6;
  }

  /* ═══════════════════════════════════════════════
   *  7. TERMS & CONDITIONS
   * ═══════════════════════════════════════════════ */
  if (y > ph - 50) { doc.addPage(); y = 20; }
  doc.setDrawColor(210, 210, 210);
  doc.setLineWidth(0.3);
  doc.line(ml, y, pw - mr, y);
  y += 6;

  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  setTxt(doc, BLUE);
  doc.text("Terms & Conditions", ml, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  setTxt(doc, GRAY_MID);

  const defaultTerms = [
    "1. This quotation is valid for 30 days from the date of issue.",
    "2. A 50% deposit is required upon acceptance to secure scheduling.",
    "3. All equipment carries a 12-month warranty on parts and labour from date of installation.",
    "4. Installation completed within 5–10 business days of deposit confirmation, subject to stock.",
    "5. Customer is responsible for providing adequate electrical supply per unit specifications.",
    "6. This quote excludes structural modifications or electrical upgrades unless explicitly stated.",
    "7. Payment terms: Net 30 days from invoice date. Late payments attract 2% monthly interest.",
    "8. A cancellation fee of 15% of total quoted amount applies after acceptance.",
    "9. Prices are quoted in South African Rand (ZAR) and include VAT at 15% as shown.",
    "10. Additional work not covered in this quotation will be quoted separately.",
  ];

  const termsToUse = opts.terms ? opts.terms.split("\n").filter(Boolean) : defaultTerms;
  termsToUse.forEach((t) => {
    if (y > ph - 18) { doc.addPage(); y = 20; }
    doc.text(t, ml, y);
    y += 3.5;
  });

  /* ═══════════════════════════════════════════════
   *  8. BANKING DETAILS
   * ═══════════════════════════════════════════════ */
  y += 4;
  if (y > ph - 30) { doc.addPage(); y = 20; }
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  setTxt(doc, BLUE);
  doc.text("Banking Details", ml, y);
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  setTxt(doc, GRAY_MID);
  const bankLines = [
    "Bank: First National Bank (FNB)",
    "Account Name: 0800-BE-COOL AC Super Service",
    "Account Number: 62 XXX XXX XXX",
    "Branch Code: 250 655",
    "Reference: " + (opts.docNumber || "Quote"),
  ];
  bankLines.forEach((l) => {
    doc.text(l, ml, y);
    y += 3.5;
  });

  /* ═══════════════════════════════════════════════
   *  9. FOOTER (fixed on every page)
   * ═══════════════════════════════════════════════ */
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    // Bottom blue stripe with grey gradient
    setFill(doc, { r: 220, g: 225, b: 235 });
    doc.rect(0, ph - 12, pw, 2, "F");
    setFill(doc, BLUE_DARK);
    doc.rect(0, ph - 10, pw, 10, "F");
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    setTxt(doc, WHITE);
    doc.text("0800-BE-COOL! AC Super Service", ml, ph - 4);
    doc.text("info@0800becool.co.za · 0800 23 2665", pw / 2, ph - 4, { align: "center" });
    doc.text("www.0800becool.co.za", pw - mr, ph - 4, { align: "right" });
  }

  /* ═══════════════════════════════════════════════
   *  10. OUTPUT: merge brochures or save
   * ═══════════════════════════════════════════════ */
  if (opts.brochures && opts.brochures.length > 0) {
    const quoteBytes = doc.output("arraybuffer");
    const merged = await assembleQuoteWithBrochures({
      mainQuotePdfBytes: new Uint8Array(quoteBytes),
      brochures: opts.brochures,
      quoteNumber: opts.docNumber,
    });
    const blob = new Blob([new Uint8Array(merged)], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${opts.docType}-${opts.docNumber}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } else {
    doc.save(`${opts.docType}-${opts.docNumber}.pdf`);
  }
}
