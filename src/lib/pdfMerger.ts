import { PDFDocument } from "pdf-lib";

/* ────────── Types ────────── */

export interface BrochureAttachment {
  id: string;
  name: string;
  file_url: string;
}

interface AssembleOptions {
  mainQuotePdfBytes: Uint8Array;
  brochures: BrochureAttachment[];
  termsPdfBytes?: Uint8Array;
  quoteNumber?: string;
}

/* ────────── Helpers ────────── */

export async function getPageCount(pdfBytes: ArrayBuffer): Promise<number> {
  const doc = await PDFDocument.load(pdfBytes);
  return doc.getPageCount();
}

/* ────────── Main assembler ────────── */

export async function assembleQuoteWithBrochures(
  opts: AssembleOptions
): Promise<Uint8Array> {
  try {
    const merged = await PDFDocument.create();

    // 1. Main quote pages
    const quoteDoc = await PDFDocument.load(opts.mainQuotePdfBytes);
    const quotePages = await merged.copyPages(quoteDoc, quoteDoc.getPageIndices());
    quotePages.forEach((p) => merged.addPage(p));

    // 2. Brochure pages (in order)
    for (const brochure of opts.brochures) {
      try {
        const url = brochure.file_url;
        const res = await fetch(url);
        if (!res.ok) {
          console.warn(`Brochure fetch failed (${res.status}): ${brochure.name} — ${url}`);
          continue;
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = await merged.copyPages(doc, doc.getPageIndices());
        pages.forEach((p) => merged.addPage(p));
      } catch (e) {
        console.warn(`Skipping brochure "${brochure.name}":`, e);
      }
    }

    // 3. T&Cs pages
    if (opts.termsPdfBytes) {
      try {
        const tcsDoc = await PDFDocument.load(opts.termsPdfBytes);
        const tcsPages = await merged.copyPages(tcsDoc, tcsDoc.getPageIndices());
        tcsPages.forEach((p) => merged.addPage(p));
      } catch (e) {
        console.warn("Failed to append T&Cs PDF:", e);
      }
    }

    // Set metadata
    if (opts.quoteNumber) {
      merged.setTitle(`Quote ${opts.quoteNumber}`);
    }
    merged.setProducer("BeCool Quote Builder");
    merged.setCreationDate(new Date());

    return merged.save({ useObjectStreams: false });
  } catch (e: any) {
    throw new Error(`PDF assembly failed: ${e.message}`);
  }
}
