import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  BULK_QUOTE_PDF_CAP,
  combinedQuotePdfName,
  estimatesInSelection,
  mergePdfBlobs,
  quotePdfPriceBlockMessage,
  safeFilePart,
} from "@/lib/bulkQuotePdf";

const noon = new Date("2026-11-12T10:00:00Z");

async function onePage(text: string, width: number): Promise<Blob> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([width, 200]);
  page.drawText(text, { x: 20, y: 100, size: 16, font: await doc.embedFont(StandardFonts.Helvetica) });
  return new Blob([new Uint8Array(await doc.save())], { type: "application/pdf" });
}

describe("combined quote PDF", () => {
  it("keeps list order and drops proposals", () => {
    const docs = [
      { id: "a", kind: "estimate", ref: "Q-1" },
      { id: "b", kind: "proposal", ref: "Visual" },
      { id: "c", kind: "estimate", ref: "Q-2" },
      { id: "d", kind: "estimate", ref: "Q-3" },
    ];
    expect(estimatesInSelection(docs, ["d", "b", "a"]).map((d) => d.ref)).toEqual(["Q-1", "Q-3"]);
  });

  it("names the file with the date, and the customer when every quote is theirs", () => {
    expect(combinedQuotePdfName(["Demo Client A", "demo client a"], noon)).toBe("Quotes-Demo Client A-2026-11-12.pdf");
    expect(combinedQuotePdfName(["Demo Client A", "Demo Client B"], noon)).toBe("Quotes-2026-11-12.pdf");
    expect(combinedQuotePdfName(["Demo Client A", ""], noon)).toBe("Quotes-2026-11-12.pdf");
    expect(combinedQuotePdfName([], noon)).toBe("Quotes-2026-11-12.pdf");
  });

  it("strips characters a file name cannot hold", () => {
    expect(safeFilePart('Demo/Client: "A"')).toBe("Demo Client A");
    expect(combinedQuotePdfName(['Demo/Client: "A"', 'Demo/Client: "A"'], noon)).toBe("Quotes-Demo Client A-2026-11-12.pdf");
  });

  it("uses the same missing-price rule as the single PDF button, and does not block labour", () => {
    expect(quotePdfPriceBlockMessage([{ id: "1", item_name: "Indoor unit", quantity: 1, unit_price: 0, item_type: "equipment" }], {})).toMatch(/Indoor unit/);
    expect(quotePdfPriceBlockMessage([{ id: "1", item_name: "Labour", item_type: "labour", quantity: 1, unit_price: 0 }], {})).toBeNull();
    expect(quotePdfPriceBlockMessage([{ id: "1", item_name: "Indoor unit", quantity: 1, unit_price: 100 }], {})).toBeNull();
  });

  it("merges quote PDFs in the order given", async () => {
    const merged = await mergePdfBlobs([await onePage("FIRST", 210), await onePage("SECOND", 320)]);
    const bytes = typeof merged.arrayBuffer === "function"
      ? new Uint8Array(await merged.arrayBuffer())
      : await new Promise<Uint8Array>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(merged);
      });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getWidth()).toBe(210);
    expect(doc.getPage(1).getWidth()).toBe(320);
    expect(BULK_QUOTE_PDF_CAP).toBe(50);
  });

  it("the list download and the single Download PDF button share one renderer, and the list path does not write", () => {
    const single = readFileSync("src/hooks/useQuoteDocumentActions.tsx", "utf8");
    const bulk = readFileSync("src/hooks/useBulkQuotePdf.tsx", "utf8");
    const list = readFileSync("src/components/quoting/QuotesList.tsx", "utf8");
    expect(single).toContain("renderClientQuotePdfBlob");
    expect(bulk).toContain("renderClientQuotePdfBlob");
    expect(bulk).not.toContain("logPdfActivity");
    expect(bulk).not.toMatch(/\.update\(|\.insert\(|\.delete\(/);
    expect(list).toContain("<QuotePdfSelectionBar");
    const cards = list.slice(list.indexOf('data-testid="quotes-list-cards"'), list.indexOf('data-testid="quotes-list-table"'));
    expect(cards).toContain("<Checkbox");
    expect(single).toContain('const handlePrint = async () => { await handlePdf("print"); };');
  });
});
