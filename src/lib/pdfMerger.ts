import { PDFDocument } from "pdf-lib";

export async function assembleQuoteWithBrochures(
  quotePdfBytes: Uint8Array,
  brochureUrls: string[],
  tcsPdfBytes?: Uint8Array
): Promise<Uint8Array> {
  const merged = await PDFDocument.create();

  const quoteDoc = await PDFDocument.load(quotePdfBytes);
  const quotePages = await merged.copyPages(quoteDoc, quoteDoc.getPageIndices());
  quotePages.forEach((p) => merged.addPage(p));

  for (const url of brochureUrls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      const doc = await PDFDocument.load(bytes);
      const pages = await merged.copyPages(doc, doc.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
    } catch (e) {
      console.warn("Failed to merge brochure:", url, e);
    }
  }

  if (tcsPdfBytes) {
    const tcsDoc = await PDFDocument.load(tcsPdfBytes);
    const tcsPages = await merged.copyPages(tcsDoc, tcsDoc.getPageIndices());
    tcsPages.forEach((p) => merged.addPage(p));
  }

  return merged.save();
}

export async function getPageCount(pdfBytes: ArrayBuffer): Promise<number> {
  const doc = await PDFDocument.load(pdfBytes);
  return doc.getPageCount();
}
