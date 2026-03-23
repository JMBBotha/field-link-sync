import jsPDF from "jspdf";
import { assembleQuoteWithBrochures, type BrochureAttachment } from "./pdfMerger";
import { EMBEDDED_LOGO_DATA_URL } from "./embeddedLogoDataUrl";

/* ─── South African Rand formatter ─── */
const fmtZAR = (n: number): string => {
  const parts = n.toFixed(2).split(".");
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `R ${intPart},${parts[1]}`;
};

/* ─── Brand colours ─── */
const BLUE = { r: 0, g: 119, b: 182 };
const NAVY = { r: 30, g: 58, b: 95 };
const AMBER = { r: 245, g: 158, b: 11 };
const GRAY = { r: 120, g: 120, b: 120 };
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

function fill(doc: jsPDF, c: { r: number; g: number; b: number }) { doc.setFillColor(c.r, c.g, c.b); }
function txt(doc: jsPDF, c: { r: number; g: number; b: number }) { doc.setTextColor(c.r, c.g, c.b); }

/* ─── Load logo: try dynamic URL, then embedded base64 ─── */
async function loadLogoDataUrl(dynamicUrl?: string | null): Promise<string> {
  // Try dynamic company logo URL first
  if (dynamicUrl) {
    try {
      const url = dynamicUrl.startsWith("http") ? dynamicUrl : new URL(dynamicUrl, window.location.origin).href;
      const dataUrl = await imgToDataUrl(url);
      if (dataUrl) return dataUrl;
    } catch { /* fall through */ }
  }
  // Always-works fallback: embedded base64
  return EMBEDDED_LOGO_DATA_URL;
}

function imgToDataUrl(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext("2d");
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0);
        resolve(c.toDataURL("image/png"));
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/* ─── Gradient line helper (simulates blue→transparent with strips) ─── */
function drawGradientLine(doc: jsPDF, x: number, y: number, w: number) {
  // 3 strips from solid navy to lighter to very light
  doc.setDrawColor(NAVY.r, NAVY.g, NAVY.b);
  doc.setLineWidth(0.8);
  doc.line(x, y, x + w * 0.5, y);
  doc.setDrawColor(BLUE.r, BLUE.g, BLUE.b);
  doc.setLineWidth(0.5);
  doc.line(x + w * 0.5, y, x + w * 0.8, y);
  doc.setDrawColor(180, 200, 220);
  doc.setLineWidth(0.3);
  doc.line(x + w * 0.8, y, x + w, y);
}

export async function generateDocumentPdf(opts: DocumentPdfOptions) {
  const doc = new jsPDF();
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const ml = 15;
  const mr = 15;
  const cw = pw - ml - mr;
  const rightEdge = pw - mr;
  let y = 10;

  /* ═══════════════════════════════════════════════
   *  1. HEADER – White background, logo LEFT, company info RIGHT
   *     NO colored banner. Matches on-screen exactly.
   * ═══════════════════════════════════════════════ */
  const logoDataUrl = await loadLogoDataUrl(opts.logoUrl);

  // Logo: large, ~78mm wide × ~29mm tall (842×316 aspect = 2.67:1)
  const logoW = 78;
  const logoH = logoW / 2.67;
  try {
    doc.addImage(logoDataUrl, "PNG", ml, y, logoW, logoH);
  } catch {
    // Text fallback
    doc.setFontSize(22);
    doc.setFont("helvetica", "bold");
    txt(doc, NAVY);
    doc.text("0800-BE-COOL!", ml, y + 12);
    doc.setFontSize(9);
    doc.text("AC SUPER SERVICE", ml, y + 18);
  }

  // Company details – right-aligned, top-aligned with logo
  let ry = y + 2;
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  txt(doc, DARK);
  doc.text(`CT - ${opts.companyName || "0800-BE-COOL AC Super Service"}`, rightEdge, ry, { align: "right" });
  if (opts.vatNumber) {
    ry += 4;
    doc.text(`VAT ${opts.vatNumber}`, rightEdge, ry, { align: "right" });
  }
  ry += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  txt(doc, GRAY);
  const addressLines = opts.companyAddress
    ? opts.companyAddress.split(",").map((s) => s.trim())
    : ["6 Aviation Cress", "Airport City", "Cape Town", "7100"];
  addressLines.forEach((line) => {
    doc.text(line, rightEdge, ry, { align: "right" });
    ry += 3.5;
  });

  /* ─── Gradient divider ─── */
  y = Math.max(y + logoH + 4, ry + 2);
  drawGradientLine(doc, ml, y, cw);
  y += 8;

  /* ═══════════════════════════════════════════════
   *  2. INFO GRID – 4 columns, matching on-screen
   * ═══════════════════════════════════════════════ */
  const colW = cw / 4;
  const c1 = ml, c2 = ml + colW, c3 = ml + colW * 2, c4 = ml + colW * 3;

  const lbl = () => { doc.setFontSize(6.5); doc.setFont("helvetica", "bold"); txt(doc, GRAY); };
  const val = () => { doc.setFontSize(9); doc.setFont("helvetica", "bold"); txt(doc, DARK); };

  // Row 1 labels
  lbl();
  doc.text("BILLED TO", c1, y);
  doc.text("DATE OF ISSUE", c2, y);
  doc.text(`${opts.docType.toUpperCase()} NUMBER`, c3, y);
  doc.text("QUOTED AMOUNT (ZAR)", c4, y);

  // Row 1 values
  const vy = y + 5;
  val();
  doc.text(opts.customerName || "—", c1, vy);

  // Customer address/email below name
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  txt(doc, GRAY);
  let custY = vy + 4;
  if (opts.customerAddress) {
    const al = doc.splitTextToSize(opts.customerAddress, colW - 4);
    doc.text(al, c1, custY);
    custY += al.length * 3.2;
  }
  if (opts.customerEmail) {
    doc.text(opts.customerEmail, c1, custY);
  }

  val();
  doc.text(opts.issueDate || "—", c2, vy);
  doc.text(opts.docNumber || "DRAFT", c3, vy);

  // Large orange quoted amount
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  txt(doc, AMBER);
  doc.text(fmtZAR(opts.total), c4, vy);

  // Row 2: Valid Until + Reference
  const r2y = vy + 14;
  lbl();
  doc.text("VALID UNTIL", c2, r2y);
  doc.text("REFERENCE / PO#", c3, r2y);
  val();
  doc.setFontSize(8);
  doc.text(opts.dueDate || "—", c2, r2y + 4);
  doc.text(opts.reference || "—", c3, r2y + 4);

  y = r2y + 10;

  /* ─── Gradient divider ─── */
  drawGradientLine(doc, ml, y, cw);
  y += 8;

  /* ═══════════════════════════════════════════════
   *  3. LINE ITEMS TABLE
   * ═══════════════════════════════════════════════ */
  const hasMarkup = opts.lineItems.some((i) => i.markup && i.markup > 0);
  const dX = ml + 2;
  const cstX = hasMarkup ? ml + cw * 0.50 : ml + cw * 0.55;
  const qX = hasMarkup ? ml + cw * 0.62 : ml + cw * 0.68;
  const mX = ml + cw * 0.75;
  const tX = rightEdge - 2;

  // Table header
  fill(doc, { r: 240, g: 243, b: 248 });
  doc.rect(ml, y - 4, cw, 7, "F");
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  txt(doc, NAVY);
  doc.text("DESCRIPTION", dX, y);
  doc.text("COST", cstX, y, { align: "right" });
  doc.text("QTY", qX, y, { align: "right" });
  if (hasMarkup) doc.text("MARKUP%", mX, y, { align: "right" });
  doc.text("TOTAL", tX, y, { align: "right" });

  y += 3;
  doc.setDrawColor(NAVY.r, NAVY.g, NAVY.b);
  doc.setLineWidth(0.3);
  doc.line(ml, y, rightEdge, y);
  y += 4;

  // Rows
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "normal");

  opts.lineItems.forEach((item, idx) => {
    if (!item.description) return;
    if (y > ph - 40) { doc.addPage(); y = 20; }

    // Alternating row bg
    if (idx % 2 === 0) {
      fill(doc, { r: 250, g: 251, b: 253 });
      doc.rect(ml, y - 3.5, cw, 7, "F");
    }

    // Description – smart truncation
    const maxW = (hasMarkup ? cw * 0.46 : cw * 0.50) - 4;
    let desc = item.description;
    while (doc.getTextWidth(desc) > maxW && desc.length > 3) desc = desc.slice(0, -1);
    if (desc.length < item.description.length) desc += "…";

    txt(doc, DARK);
    doc.text(desc, dX, y);
    doc.text(fmtZAR(item.rate), cstX, y, { align: "right" });
    doc.text(String(item.quantity), qX, y, { align: "right" });
    if (hasMarkup) doc.text(item.markup ? `${item.markup}%` : "—", mX, y, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.text(fmtZAR(item.amount), tX, y, { align: "right" });
    doc.setFont("helvetica", "normal");

    y += 7;
    doc.setDrawColor(230, 230, 230);
    doc.setLineWidth(0.15);
    doc.line(ml, y - 3, rightEdge, y - 3);
  });

  y += 4;

  /* ═══════════════════════════════════════════════
   *  4. TOTALS
   * ═══════════════════════════════════════════════ */
  if (y > ph - 55) { doc.addPage(); y = 20; }

  // Thin separator
  doc.setDrawColor(210, 210, 210);
  doc.setLineWidth(0.2);
  doc.line(rightEdge - 85, y, rightEdge, y);
  y += 5;

  const tlX = rightEdge - 82;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  txt(doc, GRAY);
  doc.text("Subtotal", tlX, y);
  txt(doc, DARK);
  doc.text(fmtZAR(opts.subtotal), tX, y, { align: "right" });
  y += 5;

  if (opts.discountAmount && opts.discountAmount > 0) {
    txt(doc, GRAY);
    doc.text("Discount", tlX, y);
    txt(doc, DARK);
    doc.text(`-${fmtZAR(opts.discountAmount)}`, tX, y, { align: "right" });
    y += 5;
  }

  txt(doc, GRAY);
  doc.text(`VAT (${opts.taxRate}%)`, tlX, y);
  txt(doc, DARK);
  doc.text(fmtZAR(opts.taxAmount), tX, y, { align: "right" });
  y += 6;

  // Amber total bar – only place with amber/orange
  const tbW = 90;
  const tbX = rightEdge - tbW;
  fill(doc, AMBER);
  doc.roundedRect(tbX, y - 4.5, tbW, 10, 2, 2, "F");
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  txt(doc, WHITE);
  doc.text("Total (ZAR)", tbX + 4, y + 1.5);
  doc.text(fmtZAR(opts.total), rightEdge - 3, y + 1.5, { align: "right" });
  y += 18;

  /* ═══════════════════════════════════════════════
   *  5. NOTES
   * ═══════════════════════════════════════════════ */
  if (opts.notes) {
    if (y > ph - 35) { doc.addPage(); y = 20; }
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    txt(doc, GRAY);
    doc.text("NOTES", ml, y);
    y += 4;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    txt(doc, DARK);
    const nl = doc.splitTextToSize(opts.notes, cw);
    doc.text(nl, ml, y);
    y += nl.length * 3.5 + 6;
  }

  /* ═══════════════════════════════════════════════
   *  6. TERMS & CONDITIONS
   * ═══════════════════════════════════════════════ */
  if (y > ph - 50) { doc.addPage(); y = 20; }
  doc.setDrawColor(210, 210, 210);
  doc.setLineWidth(0.3);
  doc.line(ml, y, rightEdge, y);
  y += 6;

  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  txt(doc, BLUE);
  doc.text("Terms & Conditions", ml, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  txt(doc, GRAY);

  const defaultTerms = [
    "MassAir Ind cc – Terms and Conditions for Quotations and Air Conditioning Services",
    "",
    "1. Scope of Work",
    "1.1 Upon your acceptance of this quotation (by payment of the deposit or full unit cost as specified), MassAir Ind cc agrees to supply and install the air conditioning equipment and perform the services detailed in the quotation.",
    "1.2 All work will be carried out by qualified, experienced technicians in a professional manner, in compliance with relevant industry standards, safety regulations, and manufacturer guidelines.",
    "",
    "2. Pricing and Payment Terms",
    "2.1 To secure the best pricing and confirm your order, the full cost of the air conditioning unit(s) is payable upfront upon acceptance of this quotation. The balance for installation and any additional services is due upon satisfactory completion of the project.",
    "2.2 All products supplied by MassAir Ind cc carry the manufacturer's warranty as detailed in Section 5, plus our workmanship warranty.",
    "2.3 Unless alternative payment arrangements are agreed in writing by management, the client is responsible for all payments.",
    "2.4 Ownership of all goods and equipment remains with MassAir Ind cc until payment is received in full.",
    "2.5 Prices are valid for 30 days from the date of the quotation unless otherwise stated.",
    "",
    "3. Electrical Requirements",
    "3.1 Unless explicitly included in the quotation, electrical work (including connection to the distribution board/DB board) is excluded.",
    "3.2 A suitable electrical point (plug or isolator) must be provided by the client within 1.5 meters of the outdoor unit location.",
    "For units 24,000 BTU to 60,000 BTU: A dedicated electrical circuit and isolator are required.",
    "For units 9,000 BTU to 18,000 BTU: A standard plug point is sufficient, provided it meets load requirements.",
    "",
    "4. Building and Structural Work",
    "4.1 Unless specifically itemized in the quotation, all building-related work is excluded.",
    "4.2 Such work can be quoted separately if required.",
    "",
    "5. Warranty",
    "5.1 Standard warranty: 2 years on all moving parts and a 3-year manufacturer's warranty on the compressor.",
    "5.2 Extended compressor warranty: When you enter into our recommended service contract, the compressor warranty is extended to 5 years.",
    "5.3 Warranty applies only to new equipment supplied and installed by MassAir Ind cc.",
    "",
    "6. Banking Details",
    "Account Name: MASSAIR IND CC",
    "Bank: FNB",
    "Account Type: Cheque Account",
    "Account Number: 62326769075",
    "Branch Code: 250 655",
    "",
    "7. Deposit / Payment Reference",
    "Please use the Proposal/Quotation number as the payment reference.",
    "",
    "8. Confidentiality",
    "We value your privacy. All information provided will be treated as confidential.",
    "",
    "9. Termination",
    "Either party may terminate by providing written notice. Outstanding payments for goods supplied and services rendered remain due.",
    "",
    "10. Dispute Resolution",
    "Both parties agree to first attempt resolution through good-faith discussions.",
    "",
    "Important: The Value of Regular Air Conditioning Servicing",
    "Regular maintenance is essential for optimal performance, energy efficiency, and longevity.",
    "Residential units: At least once a year (ideally before peak season).",
    "Commercial units: Every 6 months.",
    "",
    "Thank you for considering MassAir Ind cc for your air conditioning needs.",
  ];

  // Use provided terms if available, otherwise fall back to hardcoded defaults
  const termsToRender = opts.terms ? opts.terms.split('\n') : defaultTerms;
  termsToRender.forEach((t) => {
    if (y > ph - 18) { doc.addPage(); y = 20; }
    if (t === "") { y += 2; return; }
    // Wrap long lines
    const wrapped = doc.splitTextToSize(t, cw);
    wrapped.forEach((line: string) => {
      if (y > ph - 18) { doc.addPage(); y = 20; }
      doc.text(line, ml, y);
      y += 3.5;
    });
  });

  /* Banking details now included in Terms & Conditions above */

  /* ═══════════════════════════════════════════════
   *  8. FOOTER – subtle blue-grey bar on every page
   * ═══════════════════════════════════════════════ */
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    // Light grey-blue footer
    fill(doc, { r: 235, g: 240, b: 248 });
    doc.rect(0, ph - 12, pw, 12, "F");
    // Navy bottom edge
    fill(doc, NAVY);
    doc.rect(0, ph - 3, pw, 3, "F");
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");
    txt(doc, NAVY);
    doc.text("0800-BE-COOL! AC Super Service", ml, ph - 6);
    txt(doc, GRAY);
    doc.text("info@0800becool.co.za · 0800 23 2665", pw / 2, ph - 6, { align: "center" });
    doc.text("www.0800becool.co.za", rightEdge, ph - 6, { align: "right" });
  }

  /* ═══════════════════════════════════════════════
   *  9. OUTPUT – merge brochures or save directly
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
