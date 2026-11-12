import { PDFDocument } from "pdf-lib";
import { r0Summary, type R0Offender } from "@/lib/r0Highlight";
import { r0QuoteOffenders } from "@/lib/zeroPriceGuard";
import { todayInJohannesburg } from "@/lib/todaysJobs";

/** Most quotes one combined download will build. Each one is a full client PDF. */
export const BULK_QUOTE_PDF_CAP = 50;

type QuoteLine = Parameters<typeof r0QuoteOffenders>[0][number];

/** Estimates only, in the list order the caller already applied. Proposals are not quote PDFs. */
export function estimatesInSelection<T extends { id: string; kind: string }>(docs: T[], selectedIds: readonly string[]): T[] {
  const picked = new Set(selectedIds);
  return docs.filter((d) => picked.has(d.id) && d.kind === "estimate");
}

/**
 * Same price gate as the single-quote Download PDF button (blockR0Quote), as a message
 * instead of a toast, so one draft does not stop the rest of the file.
 */
export function quotePdfPriceBlockMessage(lines: QuoteLine[], areaNames: Record<string, string> = {}): string | null {
  const offs: R0Offender[] = r0QuoteOffenders(lines, areaNames);
  if (!offs.length) return null;
  return `Enter a price for ${r0Summary(offs)}`;
}

/** Strip characters that break a downloaded file name. */
export function safeFilePart(value: string): string {
  return value
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 80);
}

/**
 * Quotes-YYYY-MM-DD.pdf, or Quotes-<Customer>-YYYY-MM-DD.pdf when every quote
 * that will be in the file names the same customer. Date is Johannesburg.
 */
export function combinedQuotePdfName(customerNames: Array<string | null | undefined>, now = new Date()): string {
  const date = todayInJohannesburg(now);
  const trimmed = customerNames.map((n) => (n || "").replace(/\s+/g, " ").trim());
  const named = trimmed.filter(Boolean);
  const same = named.length > 0 && named.length === trimmed.length && named.every((n) => n.toLowerCase() === named[0].toLowerCase());
  const customer = same ? safeFilePart(named[0]) : "";
  return customer ? `Quotes-${customer}-${date}.pdf` : `Quotes-${date}.pdf`;
}

/** jsdom's Blob has no arrayBuffer(); FileReader works there and in the browser. */
async function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") return new Uint8Array(await blob.arrayBuffer());
  const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error || new Error("Could not read the PDF"));
    reader.readAsArrayBuffer(blob);
  });
  return new Uint8Array(buf);
}

/** One PDF, pages in the order the blobs were given (each blob is already one quote, terms included). */
export async function mergePdfBlobs(blobs: Blob[]): Promise<Blob> {
  if (!blobs.length) throw new Error("No quotes to combine");
  const merged = await PDFDocument.create();
  for (const blob of blobs) {
    const src = await PDFDocument.load(await blobBytes(blob), { ignoreEncryption: true });
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  }
  merged.setProducer("Field Lynk");
  merged.setCreationDate(new Date());
  const bytes = await merged.save();
  return new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
}
