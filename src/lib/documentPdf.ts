import { createElement } from "react";
import jsPDF from "jspdf";
import { pdf } from "@react-pdf/renderer";
import QuotePDFDocument, {
  type QuotePDFData,
  type QuotePDFLineItem,
} from "@/components/QuotePDFDocument";
import { assembleQuoteWithBrochures, type BrochureAttachment } from "./pdfMerger";
import { TERMS_BLOCKS } from "./defaultTerms";

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

function appendTermsPages(doc: jsPDF, _legacyText?: string) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginLeft = 20;
  const marginRight = 20;
  const topMargin = 25;
  const bottomLimit = pageHeight - 20;
  const contentWidth = pageWidth - marginLeft - marginRight;
  const centerX = pageWidth / 2;

  doc.addPage();
  let y = topMargin;

  const ensureSpace = (needed: number) => {
    if (y + needed > bottomLimit) {
      doc.addPage();
      y = topMargin;
    }
  };

  const renderWrappedCentered = (text: string, fontSize: number, fontStyle: string, lineHeight: number) => {
    doc.setFont("helvetica", fontStyle);
    doc.setFontSize(fontSize);
    const wrapped: string[] = doc.splitTextToSize(text, contentWidth);
    for (const line of wrapped) {
      ensureSpace(lineHeight);
      doc.text(line, centerX, y, { align: "center" });
      y += lineHeight;
    }
  };

  for (const block of TERMS_BLOCKS) {
    switch (block.type) {
      case "title":
        ensureSpace(8);
        renderWrappedCentered(block.text, 11, "bold", 5.5);
        y += 3;
        break;

      case "heading":
        ensureSpace(10);
        y += 3;
        renderWrappedCentered(block.text, 10, "bold", 5);
        y += 2;
        break;

      case "paragraph":
        ensureSpace(5);
        renderWrappedCentered(block.text, 9, "normal", 4.5);
        y += 2;
        break;

      case "bullet": {
        ensureSpace(5);
        const bulletText = `•   ${block.text}`;
        renderWrappedCentered(bulletText, 9, "normal", 4.5);
        y += 1;
        break;
      }

      case "banking":
        ensureSpace(5.5);
        renderWrappedCentered(block.text, 9, "bold", 5);
        break;

      case "spacer":
        y += 4;
        break;
    }
  }
}

function toQuotePdfLineItem(item: DocumentPdfOptions["lineItems"][number]): QuotePDFLineItem {
  return {
    areaName: item.description,
    unitName: "",
    btu: 0,
    quantity: item.quantity,
    unitPrice: item.rate,
    markupPercent: item.markup ?? 0,
    lineTotal: item.amount,
    subItems: [],
  };
}

function buildQuotePdfData(opts: DocumentPdfOptions): QuotePDFData {
  const discountAmount = opts.discountAmount ?? 0;
  const subtotalExVat = Math.max(0, opts.subtotal - discountAmount);

  return {
    quoteNumber: opts.docNumber || "QUOTE",
    date: opts.issueDate,
    validUntil: opts.dueDate || opts.issueDate,
    clientName: opts.customerName,
    clientEmail: opts.customerEmail || "",
    items: opts.lineItems.filter((item) => item.description.trim()).map(toQuotePdfLineItem),
    subtotal: subtotalExVat,
    vatRate: opts.taxRate / 100,
    vatAmount: opts.taxAmount,
    total: opts.total,
    logoUrl: opts.logoUrl || null,
  };
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
 * Generates a PDF for invoices/proposals from captured DOM, and for quotes
 * from the styled react-pdf document (QuotePDFDocument).
 */
export async function generateDocumentPdf(opts: DocumentPdfOptions) {
  let disableCaptureMode: (() => void) | null = null;

  try {
    const fileName = `${opts.docType}-${opts.docNumber || "DRAFT"}.pdf`;

    if (opts.docType === "Quote") {
      const quoteData = buildQuotePdfData(opts);
      const blob = await pdf(createElement(QuotePDFDocument, { data: quoteData })).toBlob();
      const mainQuotePdfBytes = new Uint8Array(await blob.arrayBuffer());

      if (opts.brochures && opts.brochures.length > 0) {
        const merged = await assembleQuoteWithBrochures({
          mainQuotePdfBytes,
          brochures: opts.brochures,
          quoteNumber: opts.docNumber,
        });

        downloadPdfBlob(new Uint8Array(merged), fileName);
        return;
      }

      downloadPdfBlob(mainQuotePdfBytes, fileName);
      return;
    }

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

    appendTermsPages(doc, opts.terms);

    if (opts.brochures && opts.brochures.length > 0) {
      const quoteBytes = doc.output("arraybuffer");
      const merged = await assembleQuoteWithBrochures({
        mainQuotePdfBytes: new Uint8Array(quoteBytes),
        brochures: opts.brochures,
        quoteNumber: opts.docNumber,
      });

      downloadPdfBlob(new Uint8Array(merged), fileName);
      return;
    }

    doc.save(fileName);
  } catch (err: any) {
    console.error("[PDF] generateDocumentPdf error:", err);
    throw err;
  } finally {
    disableCaptureMode?.();
  }
}
