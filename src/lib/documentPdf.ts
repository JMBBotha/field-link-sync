import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { assembleQuoteWithBrochures, type BrochureAttachment } from "./pdfMerger";
import { DEFAULT_TERMS } from "./defaultTerms";

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
  const style = document.createElement("style");
  style.setAttribute("data-pdf-capture-style", "true");
  style.textContent = `
    .${CAPTURE_MODE_CLASS} [data-pdf-hide] {
      display: none !important;
    }

    .${CAPTURE_MODE_CLASS} [data-pdf-capture-root] button,
    .${CAPTURE_MODE_CLASS} [data-pdf-capture-root] input,
    .${CAPTURE_MODE_CLASS} [data-pdf-capture-root] select,
    .${CAPTURE_MODE_CLASS} [data-pdf-capture-root] textarea,
    .${CAPTURE_MODE_CLASS} [data-pdf-capture-root] a,
    .${CAPTURE_MODE_CLASS} [data-pdf-capture-root] [role="button"],
    .${CAPTURE_MODE_CLASS} [data-pdf-capture-root] [data-pdf-hide-markup] {
      display: none !important;
    }
  `;

  document.body.classList.add(CAPTURE_MODE_CLASS);
  document.head.appendChild(style);

  return () => {
    document.body.classList.remove(CAPTURE_MODE_CLASS);
    style.remove();
  };
}

async function waitForCaptureFrame() {
  try {
    await document.fonts?.ready;
  } catch {
    // Ignore font loading errors; capture should still continue.
  }

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function addCapturedCanvasPages(doc: jsPDF, canvas: HTMLCanvasElement) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 10;
  const contentWidth = pageWidth - margin * 2;
  const contentHeight = pageHeight - margin * 2;

  const imageData = canvas.toDataURL("image/png", 1);
  const imageHeight = (canvas.height * contentWidth) / canvas.width;

  for (let offsetY = 0; offsetY < imageHeight; offsetY += contentHeight) {
    if (offsetY > 0) doc.addPage();
    doc.addImage(imageData, "PNG", margin, margin - offsetY, contentWidth, imageHeight, undefined, "FAST");
  }
}

function appendTermsPages(doc: jsPDF, termsText: string) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginLeft = 15;
  const marginRight = 15;
  const topMargin = 20;
  const bottomLimit = pageHeight - 15;
  const lineHeight = 4.5;
  const contentWidth = pageWidth - marginLeft - marginRight;

  doc.addPage();
  let y = topMargin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Terms & Conditions", marginLeft, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);

  const lines = termsText.split("\n");

  for (const line of lines) {
    if (!line.trim()) {
      y += 3;
      if (y > bottomLimit) {
        doc.addPage();
        y = topMargin;
      }
      continue;
    }

    const wrapped = doc.splitTextToSize(line, contentWidth);

    for (const wrappedLine of wrapped) {
      if (y > bottomLimit) {
        doc.addPage();
        y = topMargin;
      }
      doc.text(wrappedLine, marginLeft, y);
      y += lineHeight;
    }
  }
}

function downloadPdfBlob(pdfBytes: Uint8Array, fileName: string) {
  const normalizedBytes = new Uint8Array(pdfBytes);
  const blob = new Blob([normalizedBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function generateDocumentPdf(opts: DocumentPdfOptions) {
  const captureElement = resolveCaptureElement(opts);
  const disableCaptureMode = enableCaptureMode();

  try {
    await waitForCaptureFrame();

    const capturedCanvas = await html2canvas(captureElement, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
      width: captureElement.scrollWidth,
      height: captureElement.scrollHeight,
    });

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    addCapturedCanvasPages(doc, capturedCanvas);
    appendTermsPages(doc, DEFAULT_TERMS);

    const fileName = `${opts.docType}-${opts.docNumber || "DRAFT"}.pdf`;

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
  } finally {
    disableCaptureMode();
  }
}
