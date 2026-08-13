import jsPDF from "jspdf";
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
  captureSelector?: string;
}

const CAPTURE_MODE_CLASS = "pdf-capture-mode";

function resolveCaptureElement(opts: DocumentPdfOptions): HTMLElement {
  const selectors = [
    opts.captureSelector,
    `[data-pdf-capture-root="${opts.docType.toLowerCase()}"]`,
    "[data-pdf-capture-root]",
  ].filter((selector): selector is string => Boolean(selector));

  for (const selector of selectors) {
    const found = document.querySelector<HTMLElement>(selector);
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
async function fetchTermsCompanyInfo(fallbackName?: string): Promise<TermsCompanyInfo> {
  try {
    const { data, error } = await supabase
      .from("company_settings")
      .select("company_name, banking_details")
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return { companyName: fallbackName };
    }

    const banking = (data.banking_details as Record<string, string> | null) || {};
    return {
      companyName: data.company_name || fallbackName,
      bankName: banking.bank_name,
      accountName: banking.account_name,
      accountNumber: banking.account_number,
      branchCode: banking.branch_code,
      accountType: banking.account_type,
    };
  } catch {
    return { companyName: fallbackName };
  }
}

const addTermsFooter = (doc: jsPDF, company: TermsCompanyInfo) => {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 25;

  doc.setTextColor(107, 114, 128);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");

  const footerText = company.companyName || "Our Company";

  doc.text(footerText, pageWidth / 2, pageHeight - 18, {
    maxWidth: pageWidth - margin * 2,
    align: "center",
  });
};

function appendTermsPages(doc: jsPDF, company: TermsCompanyInfo) {
  const termsBlocks = buildTermsBlocks(company);
  if (!termsBlocks || termsBlocks.length === 0) return;

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const lineHeight = 3.6;
  let y = 28;

  const BLUE = [14, 165, 233] as const;
  const DARK_GRAY = [17, 24, 39] as const;

  doc.addPage();

  // Blue accent line at top
  doc.setDrawColor(...BLUE);
  doc.setLineWidth(2.5);
  doc.line(margin, 18, pageWidth - margin, 18);

  termsBlocks.forEach((block) => {
    if (y > doc.internal.pageSize.getHeight() - 30) {
      addTermsFooter(doc, company);
      doc.addPage();
      doc.setDrawColor(...BLUE);
      doc.setLineWidth(2.5);
      doc.line(margin, 18, pageWidth - margin, 18);
      y = 28;
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

  addTermsFooter(doc, company);
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

    const capturedCanvas = await html2canvas(captureElement, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
      width: captureElement.scrollWidth,
      height: captureElement.scrollHeight,
    });

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 5;
    const usableWidth = pageWidth - margin * 2;
    const usableHeight = pageHeight - margin * 2;
    const scaledHeight = (capturedCanvas.height * usableWidth) / capturedCanvas.width;
    const imgData = capturedCanvas.toDataURL("image/png", 1);

    if (scaledHeight <= usableHeight) {
      doc.addImage(imgData, "PNG", margin, margin, usableWidth, scaledHeight);
    } else {
      let remainingHeight = scaledHeight;
      let sourceY = 0;
      let page = 0;
      while (remainingHeight > 0) {
        if (page > 0) doc.addPage();
        const sliceHeight = Math.min(usableHeight, remainingHeight);
        const sourceSliceH = (sliceHeight / scaledHeight) * capturedCanvas.height;
        const sliceCanvas = document.createElement("canvas");
        sliceCanvas.width = capturedCanvas.width;
        sliceCanvas.height = sourceSliceH;
        const ctx = sliceCanvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(capturedCanvas, 0, sourceY, capturedCanvas.width, sourceSliceH, 0, 0, capturedCanvas.width, sourceSliceH);
        }
        doc.addImage(sliceCanvas.toDataURL("image/png"), "PNG", margin, margin, usableWidth, sliceHeight);
        sourceY += sourceSliceH;
        remainingHeight -= sliceHeight;
        page++;
      }
    }

    const termsCompany = await fetchTermsCompanyInfo(opts.companyName);
    appendTermsPages(doc, termsCompany);

    if (opts.brochures && opts.brochures.length > 0) {
      const quoteBytes = doc.output("arraybuffer");
      const merged = await assembleQuoteWithBrochures({
        mainQuotePdfBytes: new Uint8Array(quoteBytes),
        brochures: opts.brochures,
        quoteNumber: opts.docNumber,
      });
      return new Uint8Array(merged);
    }

    return new Uint8Array(doc.output("arraybuffer"));
  } finally {
    disableCaptureMode?.();
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
