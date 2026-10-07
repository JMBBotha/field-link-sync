/**
 * Page-by-page AI price-list reading (2026-10-07).
 * Every page is read on its own (no early stop). If a page's text layer looks
 * garbled, yields zero rows, or most codes need OCR fixes, the page image is read
 * with vision instead. Read-only: nothing here writes to the database.
 */
import { supabase } from "@/integrations/supabase/client";
import { loadPdfJs } from "@/lib/pdfPageCapture";
import { looksGarbled, sanitizeModelCode } from "@/lib/modelCodeSanitize";

export interface PageReport {
  page: number;
  rows: number;
  usedImage: boolean;
  reason?: "garbled_text" | "no_rows_from_text" | "low_confidence_codes" | "no_text";
  error?: string;
}

export interface PageReadResult {
  products: any[];
  report: PageReport[];
  detectedPriceColumns: string[];
}

/** Text per page, rows rebuilt by y-position (tab-separated cells). */
export async function extractPageTexts(data: ArrayBuffer): Promise<string[]> {
  const pdfjsLib = await loadPdfJs();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const rows = new Map<number, { str: string; x: number }[]>();
    for (const it of content.items as any[]) {
      if (!it.str || !it.transform) continue;
      const y = Math.round(it.transform[5] / 2) * 2;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y)!.push({ str: it.str, x: it.transform[4] });
    }
    const text = Array.from(rows.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) => items.sort((a, b) => a.x - b.x).map((s) => s.str.trim()).filter(Boolean).join("\t"))
      .join("\n");
    pages.push(text);
  }
  return pages;
}

function splitText(text: string, size = 5500): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + size, text.length);
    if (end < text.length) {
      const nl = text.lastIndexOf("\n", end);
      if (nl > i + size * 0.5) end = nl + 1;
    }
    out.push(text.substring(i, end));
    i = end;
  }
  return out;
}

async function callParser(body: Record<string, unknown>): Promise<{ products: any[]; cols: string[]; error?: string }> {
  const { data, error } = await supabase.functions.invoke("parse-pdf-with-grok", { body });
  if (error) return { products: [], cols: [], error: error.message || String(error) };
  return { products: data?.products || [], cols: data?.detected_price_columns || [] };
}

export async function readPagesOneByOne(opts: {
  pageTexts: string[];
  /** Same order as pageTexts; https URL or data:image URL. */
  pageImages: (string | null)[];
  supplierId: string;
  supplierName: string;
  supplierType?: string;
  onPage?: (page: number, total: number, mode: "text" | "image") => void;
}): Promise<PageReadResult> {
  const total = Math.max(opts.pageTexts.length, opts.pageImages.length);
  const products: any[] = [];
  const report: PageReport[] = [];
  const cols = new Set<string>();
  const base = { supplier_id: opts.supplierId, supplier_name: opts.supplierName, supplier_type: opts.supplierType };

  for (let i = 0; i < total; i++) {
    const page = i + 1;
    const text = (opts.pageTexts[i] || "").trim();
    const image = opts.pageImages[i] || null;
    let rows: any[] = [];
    let reason: PageReport["reason"];
    let err: string | undefined;

    const garbled = looksGarbled(text);
    if (!text || text.length < 30) reason = "no_text";
    else if (garbled) reason = "garbled_text";
    else {
      opts.onPage?.(page, total, "text");
      const chunks = splitText(text);
      for (let c = 0; c < chunks.length; c++) {
        const r = await callParser({ ...base, extracted_text: `--- Page ${page} ---\n${chunks[c]}`, page_number: page, chunk_index: c, chunk_total: chunks.length });
        r.cols.forEach((x) => cols.add(x));
        if (r.error) err = r.error;
        rows.push(...r.products);
      }
      if (rows.length === 0) reason = "no_rows_from_text";
      else {
        const low = rows.filter((p) => sanitizeModelCode(p.product_code).lowConfidence).length;
        if (low / rows.length >= 0.3) reason = "low_confidence_codes";
      }
    }

    let usedImage = false;
    if (reason && image) {
      opts.onPage?.(page, total, "image");
      const r = await callParser({ ...base, page_image_url: image, page_number: page });
      if (r.error) err = r.error;
      // Keep text rows only if vision found nothing better.
      if (r.products.length > 0 || rows.length === 0) {
        rows = r.products;
        r.cols.forEach((x) => cols.add(x));
        usedImage = true;
      }
    }

    for (const p of rows) if (!p.page_number) p.page_number = page;
    products.push(...rows);
    report.push({ page, rows: rows.length, usedImage, reason, error: err });
  }
  return { products, report, detectedPriceColumns: [...cols] };
}

/** Plain-words line, e.g. "Page 1: 12 rows, Page 2: 0 rows (used image)". */
export function formatPageReport(report: PageReport[]): string {
  return report.map((r) => `Page ${r.page}: ${r.rows} rows${r.usedImage ? " (used image)" : ""}`).join(", ");
}
