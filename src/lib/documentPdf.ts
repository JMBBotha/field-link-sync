import { COMPANY, COMPANY_CONTACT_LINE, cleanBanking } from "./companyIdentity";
import { computePageCuts, isUniformRow } from "./pdfPageBreaks";
import jsPDF from "jspdf";
import { fetchCompanyProfileSafe } from "@/lib/companyProfileSafe";
import { assembleQuoteWithBrochures, type BrochureAttachment } from "./pdfMerger";
import { buildTermsBlocks, type TermsCompanyInfo } from "./defaultTerms";
import { supabase } from "@/integrations/supabase/client";

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
  imagePages?: string[];
  captureSelector?: string;
  /** Extra elements captured as their own A4 page(s) after the document (unit brochures, Johan 13 Oct 11:53). */
  extraPageSelector?: string;
  /** Terms page for a specific issuing company (invoices). Omit = the signed-in company's primary settings. */
  termsCompany?: TermsCompanyInfo | null;
}

const CAPTURE_MODE_CLASS = "pdf-capture-mode";

function resolveCaptureElement(opts: DocumentPdfOptions): HTMLElement {
  const selectors = [
    opts.captureSelector,
    `[data-pdf-capture-root="${opts.docType.toLowerCase()}"]`,
    "[data-pdf-capture-root]",
  ].filter((selector): selector is string => Boolean(selector));

  for (const selector of selectors) {
    // Never capture the staff-only live client preview pane (it mirrors the same document).
    const found = Array.from(document.querySelectorAll<HTMLElement>(selector)).find((el) => !el.closest("[data-live-client-preview]"));
    if (found) return found;
  }

  throw new Error(`Could not find capture element. Tried selectors: ${selectors.join(", ")}`);
}

function enableCaptureMode() {
  document.body.classList.add(CAPTURE_MODE_CLASS);

  return () => {
    document.body.classList.remove(CAPTURE_MODE_CLASS);
  };
}

async function waitForCaptureFrame() {
  try {
    await document.fonts?.ready;
  } catch {
    // Ignore font loading errors
  }
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Fetches the real tenant's company/banking info directly from the database
 * for use on the terms & banking page, independent of whatever the caller
 * happened to pass in `opts`. This guarantees every PDF's terms/banking page
 * always matches the actual signed-in company—never a leftover hardcoded
 * placeholder company—even if a future call site forgets to pass it through.
 */
/** The signed-in user's own company (never another company's settings row). */
async function callerCompanyId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  const { getUserCompanyId } = await import("./tenantUtils");
  return getUserCompanyId(data.user?.id);
}

export async function fetchTermsCompanyInfo(fallbackName?: string): Promise<TermsCompanyInfo> {
  try {
    const { data, error } = await supabase
      .from("company_settings")
      .select("company_name, banking_details")
      .eq("company_id", (await callerCompanyId()) ?? "00000000-0000-0000-0000-000000000000")
      .order("is_primary" as any, { ascending: false })
      .order("updated_at", { ascending: false, nullsFirst: false })
      .order("id")
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      // Techs can't read company_settings (P9): name only, never banking.
      const safe = await fetchCompanyProfileSafe();
      return { companyName: COMPANY.legalName };
    }

    const banking = cleanBanking(data.banking_details);
    return {
      companyName: COMPANY.legalName,
      bankName: banking.bank_name || undefined,
      accountName: banking.account_name,
      accountNumber: banking.account_number || undefined,
      branchCode: banking.branch_code || undefined,
      accountType: banking.account_type || undefined,
    };
  } catch {
    return { companyName: COMPANY.legalName };
  }
}

const addTermsFooter = (doc: jsPDF, company: TermsCompanyInfo) => {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 25;

  doc.setTextColor(107, 114, 128);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");

  const footerText = company.footerLine || `${COMPANY.legalName} · ${COMPANY.tel} · VAT No ${COMPANY.vatNo} · ${COMPANY.addressLines.join(", ")}`;

  doc.text(footerText, pageWidth / 2, pageHeight - 18, {
    maxWidth: pageWidth - margin * 2,
    align: "center",
  });
  doc.setFontSize(8);
  doc.text(company.contactLine || COMPANY_CONTACT_LINE, pageWidth / 2, pageHeight - 13, { maxWidth: pageWidth - margin * 2, align: "center" });
};

/** Every document (quotes included) gets the drawn terms pages — the on-screen quote terms page
 * is excluded from capture (data-html2canvas-ignore), so it never prints twice or goes missing. */
export function shouldAppendFixedTerms(_docType: string | undefined): boolean {
  return true;
}

/** reserve: when the document stamps its own page head/footer, the terms text keeps clear of
 * them (no own top line / text footer, which would overlap the stamped ones). */
function appendTermsPages(doc: jsPDF, company: TermsCompanyInfo, reserve?: { top: number; bottom: number }) {
  const termsBlocks = buildTermsBlocks(company);
  if (!termsBlocks || termsBlocks.length === 0) return;

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const lineHeight = 3.6;
  const startY = reserve ? reserve.top + 6 : 28;
  const limitY = reserve ? doc.internal.pageSize.getHeight() - reserve.bottom - 6 : doc.internal.pageSize.getHeight() - 30;
  let y = startY;
  const topLine = () => { if (reserve) return; doc.setDrawColor(...BLUE); doc.setLineWidth(2.5); doc.line(margin, 18, pageWidth - margin, 18); };
  const pageFooter = () => { if (!reserve) addTermsFooter(doc, company); };

  const BLUE = [14, 165, 233] as const;
  const DARK_GRAY = [17, 24, 39] as const;

  doc.addPage();

  // Blue accent line at top
  topLine();

  termsBlocks.forEach((block) => {
    if (y > limitY) {
      pageFooter();
      doc.addPage();
      topLine();
      y = startY;
    }

    switch (block.type) {
      case "title": {
        doc.setTextColor(...BLUE);
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        const titleLines: string[] = doc.splitTextToSize(block.text || "Terms and Conditions", pageWidth - margin * 2);
        doc.text(titleLines, margin, y);
        y += titleLines.length * lineHeight + 4;
        break;
      }

      case "heading":
        doc.setTextColor(...BLUE);
        doc.setFontSize(9);
        doc.setFont("helvetica", "bold");
        doc.text(block.text, margin, y);
        y += 6;
        break;

      case "paragraph": {
        doc.setTextColor(...DARK_GRAY);
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        const paraLines: string[] = doc.splitTextToSize(block.text, pageWidth - margin * 2);
        doc.text(paraLines, margin, y);
        y += paraLines.length * lineHeight + 1.5;
        break;
      }

      case "bullet": {
        doc.setTextColor(...DARK_GRAY);
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        const bulletText = `• ${block.text}`;
        const bulletLines: string[] = doc.splitTextToSize(bulletText, pageWidth - margin * 2 - 10);
        doc.text(bulletLines, margin + 5, y);
        y += bulletLines.length * lineHeight + 1;
        break;
      }

      case "banking":
        doc.setTextColor(...DARK_GRAY);
        doc.setFontSize(8);
        doc.setFont("helvetica", "bold");
        doc.text(block.text, margin, y);
        y += lineHeight + 1.5;
        break;

      case "spacer":
        y += 2;
        break;

      default:
        doc.setTextColor(...DARK_GRAY);
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.text(block.text, margin, y);
        y += lineHeight + 1;
    }
  });

  pageFooter();
}

/**
 * Where the closing signature block goes (Johan 13 Oct 2026): always at the BOTTOM of the
 * last page, never straight under where the content stops. If it does not fit under the
 * content on that page, it goes to the bottom of a fresh page; it is never split.
 */
export function placeBottomBlock(lastPageUsedMm: number, blockHeightMm: number, pageHeightMm: number, marginMm: number, gapMm = 4) {
  const y = pageHeightMm - marginMm - blockHeightMm;
  return { newPage: marginMm + lastPageUsedMm + gapMm > y, y };
}

function downloadPdfBlob(pdfBytes: Uint8Array, fileName: string) {
  const blob = new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Captures the on-screen document (invoice/estimate/proposal) exactly as rendered,
 * appends the terms pages, merges brochures if any, and returns the final PDF bytes.
 * This is the shared core used by both the direct-download and blob/upload flows below,
 * so every document type always produces a pixel-accurate PDF of what's on screen —
 * never a separately hand-drawn, generic-looking version.
 */
async function buildDocumentPdfBytes(opts: DocumentPdfOptions): Promise<Uint8Array> {
  let disableCaptureMode: (() => void) | null = null;

  try {
    const captureElement = resolveCaptureElement(opts);

    disableCaptureMode = enableCaptureMode();
    await waitForCaptureFrame();

    const html2canvas = (await import("html2canvas")).default;

    // Rendered terms flow directly after unit cards in the main capture.
    const termsEl = captureElement.querySelector<HTMLElement>("[data-pdf-terms-page]");

    // Signature block(s) marked data-pdf-bottom are captured on their own and pinned to the
    // bottom of the last page below, so hide them from the main capture.
    // A bottom block taller than ~40% of a page (e.g. a quote's full terms) flows with the content
    // instead of being pinned, so it can never overrun the page head.
    const flowed: HTMLElement[] = [];
    captureElement.querySelectorAll<HTMLElement>("[data-pdf-bottom]").forEach((el) => {
      if (el.scrollHeight / Math.max(1, captureElement.scrollWidth) * 200 > 287 * 0.4) { el.removeAttribute("data-pdf-bottom"); el.setAttribute("data-pdf-flowed", ""); flowed.push(el); }
    });
    const bottomEls = Array.from(captureElement.querySelectorAll<HTMLElement>("[data-pdf-bottom]"));
    const bottomCanvases = [] as HTMLCanvasElement[];
    for (const el of bottomEls) {
      bottomCanvases.push(await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false, width: el.scrollWidth, height: el.scrollHeight }));
    }
    // Per-page head (thin blue/orange rule + short company line) and per-page footer (logo + unit
    // image) are captured once and stamped onto EVERY page after pagination (Johan 14 Oct).
    const headEl = captureElement.querySelector<HTMLElement>("[data-pdf-page-head]");
    const footEl = captureElement.querySelector<HTMLElement>("[data-pdf-every-page]");
    const snap = (el: HTMLElement | null) => el ? html2canvas(el, { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false, width: el.scrollWidth, height: el.scrollHeight }) : Promise.resolve(null);
    // Page 2+ head is display:none on screen; show it just for its own capture.
    const headFirstEl = captureElement.querySelector<HTMLElement>("[data-pdf-page-head-first]");
    let headCanvas: HTMLCanvasElement | null = null;
    if (headEl) { const d = headEl.style.display; headEl.style.display = "block"; headCanvas = await snap(headEl); headEl.style.display = d; }
    const headFirstCanvas = await snap(headFirstEl);
    const footCanvas = await snap(footEl);
    for (const el of [headEl, headFirstEl, footEl]) if (el) bottomEls.push(el);
    const prevDisplay = bottomEls.map((el) => el.style.display);
    bottomEls.forEach((el) => { el.style.display = "none"; });
    let capturedCanvas: HTMLCanvasElement;
    try {
      capturedCanvas = await html2canvas(captureElement, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
      width: captureElement.scrollWidth,
      height: captureElement.scrollHeight,
      });
    } finally {
      bottomEls.forEach((el, i) => { el.style.display = prevDisplay[i]; });
    }

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 5;
    const usableWidth = pageWidth - margin * 2;
    const toMm = (c: HTMLCanvasElement | null) => (c && c.width ? (c.height * usableWidth) / capturedCanvas.width : 0);
    const headH = Math.max(toMm(headCanvas), toMm(headFirstCanvas));
    const headLaterH = toMm(headCanvas);
    const headFirstH = toMm(headFirstCanvas);
    const footH = toMm(footCanvas);
    const topReserve = headH ? headH + 3 : 0;
    const botReserve = footH ? footH + 3 : 0;
    // Pages 2+ get a little extra breathing room under the page head.
    const contTop = topReserve ? 6 : 0;
    const usableHeight = pageHeight - margin * 2 - topReserve - botReserve - contTop;
    const scaledHeight = (capturedCanvas.height * usableWidth) / capturedCanvas.width;
    const imgData = capturedCanvas.toDataURL("image/png", 1);
    // Clickable links in the PDF for anchors marked data-pdf-link (our own brochure links only).
    const rootRect = captureElement.getBoundingClientRect();
    const pxToMm = usableWidth / captureElement.scrollWidth;
    const linkBoxes = Array.from(captureElement.querySelectorAll<HTMLAnchorElement>("a[data-pdf-link][href]")).map((a) => {
      const r = a.getBoundingClientRect();
      return { url: a.href, x: r.left - rootRect.left, y: r.top - rootRect.top, w: r.width, h: r.height };
    });
    const canvasScale = capturedCanvas.width / captureElement.scrollWidth;
    const addLinks = (startPx: number, endPx: number) => {
      for (const l of linkBoxes) {
        const yPx = l.y * canvasScale;
        if (yPx < startPx || yPx >= endPx) continue;
        doc.link(margin + l.x * pxToMm, margin + topReserve + (startPx > 0 ? contTop : 0) + (yPx - startPx) / canvasScale * pxToMm, l.w * pxToMm, l.h * pxToMm, { url: l.url });
      }
    };

    // Forced page breaks (Johan 14 Oct): elements marked data-pdf-break-before start a new page.
    // Measured with the bottom blocks still hidden, i.e. as captured.
    bottomEls.forEach((el) => { el.style.display = "none"; });
    const forcedCuts = Array.from(captureElement.querySelectorAll<HTMLElement>("[data-pdf-break-before]"))
      .map((el) => (el.getBoundingClientRect().top - captureElement.getBoundingClientRect().top) * canvasScale)
      .filter((y) => y > 0);
    const rootTop = captureElement.getBoundingClientRect().top;
    const keepRanges = Array.from(captureElement.querySelectorAll<HTMLElement>("[data-pdf-keep]")).map((el) => {
      const r = el.getBoundingClientRect();
      return [(r.top - rootTop) * canvasScale, (r.bottom - rootTop) * canvasScale] as [number, number];
    });
    bottomEls.forEach((el, i) => { el.style.display = prevDisplay[i]; });

    let lastPageUsed = scaledHeight + topReserve;
    if (scaledHeight <= usableHeight && forcedCuts.length === 0) {
      doc.addImage(imgData, "PNG", margin, margin + topReserve, usableWidth, scaledHeight, undefined, "FAST");
      addLinks(0, capturedCanvas.height);
    } else {
      // Split at quiet pixel rows (gaps between lines/blocks) so no text line is cut in half.
      const pageRows = Math.floor((usableHeight / scaledHeight) * capturedCanvas.height);
      const srcCtx = capturedCanvas.getContext("2d");
      const pixels = srcCtx?.getImageData(0, 0, capturedCanvas.width, capturedCanvas.height).data;
      const cuts = pixels
        ? computePageCuts((y) => isUniformRow(pixels, capturedCanvas.width, y), capturedCanvas.height, pageRows, undefined, forcedCuts, 8, keepRanges)
        : computePageCuts(() => true, capturedCanvas.height, pageRows, 0, forcedCuts);
      let sourceY = 0;
      cuts.forEach((cut, page) => {
        if (page > 0) doc.addPage();
        const sourceSliceH = cut - sourceY;
        const sliceCanvas = document.createElement("canvas");
        sliceCanvas.width = capturedCanvas.width;
        sliceCanvas.height = sourceSliceH;
        const ctx = sliceCanvas.getContext("2d");
        if (ctx) {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
          ctx.drawImage(capturedCanvas, 0, sourceY, capturedCanvas.width, sourceSliceH, 0, 0, capturedCanvas.width, sourceSliceH);
        }
        const sliceHeight = (sourceSliceH / capturedCanvas.height) * scaledHeight;
        doc.addImage(sliceCanvas.toDataURL("image/png"), "PNG", margin, margin + topReserve + (page > 0 ? contTop : 0), usableWidth, sliceHeight, undefined, "FAST");
        addLinks(sourceY, cut);
        lastPageUsed = sliceHeight + topReserve + (page > 0 ? contTop : 0);
        sourceY = cut;
      });
    }

    // Signature block: bottom of the last page, or bottom of a new page if it would overlap.
    for (const c of bottomCanvases) {
      if (!c.width || !c.height) continue;
      const h = (c.height * usableWidth) / capturedCanvas.width;
      const w = (c.width * usableWidth) / capturedCanvas.width;
      const { newPage, y } = placeBottomBlock(lastPageUsed, h, pageHeight - botReserve, margin);
      if (newPage) doc.addPage();
      doc.addImage(c.toDataURL("image/png"), "PNG", margin, y, w, h, undefined, "FAST");
      lastPageUsed = pageHeight;
    }

    // Appended pages (unit brochures): each element fitted onto its own A4 page.
    if (opts.extraPageSelector) {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(opts.extraPageSelector))) {
        try {
          const c = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false, width: el.scrollWidth, height: el.scrollHeight });
          const s = Math.min(usableWidth / c.width, usableHeight / c.height);
          doc.addPage();
          doc.addImage(c.toDataURL("image/png"), "PNG", (pageWidth - c.width * s) / 2, margin + topReserve + contTop, c.width * s, c.height * s, undefined, "FAST");
        } catch (e) {
          console.warn("[documentPdf] skipped appended page", e);
        }
      }
    }

    if (!termsEl && shouldAppendFixedTerms(opts.docType)) {
      const termsCompany = opts.termsCompany || (await fetchTermsCompanyInfo(opts.companyName));
      appendTermsPages(doc, termsCompany, headH || footH ? { top: margin + topReserve + contTop, bottom: margin + botReserve } : undefined);
    }

    // Stamp head + footer on every page (document, appended pages and terms pages).
    const headImg = headCanvas && headCanvas.width ? headCanvas.toDataURL("image/png") : null;
    const headFirstImg = headFirstCanvas && headFirstCanvas.width ? headFirstCanvas.toDataURL("image/png") : null;
    const footImg = footCanvas && footCanvas.width ? footCanvas.toDataURL("image/png") : null;
    for (let i = 1; i <= doc.getNumberOfPages(); i++) {
      doc.setPage(i);
      // Page 1: company line only. Last page: only the blue banner line (no rule, no company line).
      // Pages in between: company line above the thin blue/orange rule (Johan 14 Oct 07:53-07:54).
      const last = !termsEl && i === doc.getNumberOfPages() && i > 1;
      if (i === 1) { if (headFirstImg) doc.addImage(headFirstImg, "PNG", margin, margin, usableWidth, headFirstH, undefined, "FAST"); }
      else if (last) { if (headImg || headFirstImg) { doc.setDrawColor(14, 165, 233); doc.setLineWidth(2.5); doc.line(20, 18, pageWidth - 20, 18); } }
      else if (headImg) doc.addImage(headImg, "PNG", margin, margin, usableWidth, headLaterH, undefined, "FAST");
      if (footImg) doc.addImage(footImg, "PNG", margin, pageHeight - margin - footH, usableWidth, footH, undefined, "FAST");
    }

    if ((opts.brochures && opts.brochures.length > 0) || (opts.imagePages && opts.imagePages.length > 0)) {
      const quoteBytes = doc.output("arraybuffer");
      const merged = await assembleQuoteWithBrochures({
        mainQuotePdfBytes: new Uint8Array(quoteBytes),
        brochures: opts.brochures || [],
        imagePages: opts.imagePages,
        quoteNumber: opts.docNumber,
      });
      return new Uint8Array(merged);
    }

    return new Uint8Array(doc.output("arraybuffer"));
  } finally {
    disableCaptureMode?.();
    document.querySelectorAll<HTMLElement>("[data-pdf-flowed]").forEach((el) => { el.removeAttribute("data-pdf-flowed"); el.setAttribute("data-pdf-bottom", ""); });
  }
}

/**
 * Generates a PDF for invoices/proposals/estimates from captured DOM, and
 * triggers a browser download. Use `generateDocumentPdfBlob` instead when you
 * need the PDF bytes for upload or sharing rather than an immediate download.
 */
export async function generateDocumentPdf(opts: DocumentPdfOptions) {
  try {
    const fileName = `${opts.docType}-${opts.docNumber || "DRAFT"}.pdf`;
    const bytes = await buildDocumentPdfBytes(opts);
    downloadPdfBlob(bytes, fileName);
  } catch (err: any) {
    console.error("[PDF] generateDocumentPdf error:", err);
    throw err;
  }
}

/**
 * Same capture pipeline as `generateDocumentPdf`, but returns a Blob instead
 * of downloading — for uploading to storage, sharing a link, or sending via
 * WhatsApp/email.
 */
export async function generateDocumentPdfBlob(opts: DocumentPdfOptions): Promise<Blob> {
  try {
    const bytes = await buildDocumentPdfBytes(opts);
    return new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  } catch (err: any) {
    console.error("[PDF] generateDocumentPdfBlob error:", err);
    throw err;
  }
}
