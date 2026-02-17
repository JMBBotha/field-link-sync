/**
 * PDF Text Extraction & Product Matching Utility
 *
 * Uses pdfjs-dist to extract text items with their exact coordinates
 * from a PDF page, then cross-references against the products database.
 *
 * Requires the original PDF URL (pdf_storage_path on supplier_pdf_pages).
 */
import type { PaletteProduct } from "../QuoteBuilderTab";

/** Lazily load pdfjs-dist to avoid top-level import conflicts with CDN version */
let _pdfjsLib: any = null;
async function getPdfjsLib() {
  if (_pdfjsLib) return _pdfjsLib;
  const lib = await import("pdfjs-dist");
  lib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${lib.version}/pdf.worker.min.mjs`;
  _pdfjsLib = lib;
  return lib;
}

export interface ExtractedTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExtractedProductRegion {
  product: PaletteProduct | null;
  product_code: string;
  label: string;
  x_pct: number;
  y_pct: number;
  w_pct: number;
  h_pct: number;
  matched: boolean;
  has_price: boolean;
  detected_price: number | null;
}

/**
 * Extract all text items with their bounding boxes from a specific PDF page.
 */
export async function extractTextItemsFromPdfPage(
  pdfUrl: string,
  pageNumber: number
): Promise<{
  items: ExtractedTextItem[];
  pageWidth: number;
  pageHeight: number;
}> {
  const pdfjsLib = await getPdfjsLib();
  const loadingTask = pdfjsLib.getDocument({
    url: pdfUrl,
    cMapUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/cmaps/`,
    cMapPacked: true,
  });

  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();

  const items: ExtractedTextItem[] = [];

  for (const item of textContent.items) {
    if (!("str" in item) || !item.str.trim()) continue;

    const tx = item.transform;
    // PDF coordinates: origin is bottom-left, Y goes up
    // Convert to top-left origin for overlay positioning
    const fontSize = Math.sqrt(tx[0] * tx[0] + tx[1] * tx[1]);
    const x = tx[4];
    const y = viewport.height - tx[5] - fontSize;
    const width = item.width ?? item.str.length * fontSize * 0.6;
    const height = fontSize * 1.2;

    items.push({ text: item.str, x, y, width, height });
  }

  return { items, pageWidth: viewport.width, pageHeight: viewport.height };
}

/**
 * Group adjacent text items into rows based on Y-coordinate proximity.
 * Items within `threshold` pixels of each other vertically are grouped.
 */
function groupTextItemsIntoRows(
  items: ExtractedTextItem[],
  threshold = 6
): ExtractedTextItem[][] {
  if (items.length === 0) return [];

  const sorted = [...items].sort((a, b) => a.y - b.y);
  const rows: ExtractedTextItem[][] = [];
  let currentRow: ExtractedTextItem[] = [sorted[0]];
  let currentY = sorted[0].y;

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].y - currentY > threshold) {
      rows.push(currentRow);
      currentRow = [];
      currentY = sorted[i].y;
    }
    currentRow.push(sorted[i]);
  }
  if (currentRow.length > 0) rows.push(currentRow);

  // Sort items within each row by X position
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
  }

  return rows;
}

/**
 * Build a lookup map from products for efficient matching.
 */
function buildProductLookup(products: PaletteProduct[]) {
  const byCode = new Map<string, PaletteProduct>();
  const byName = new Map<string, PaletteProduct>();

  for (const p of products) {
    if (p.product_code) {
      byCode.set(p.product_code.toLowerCase().trim(), p);
    }
    if (p.short_name) {
      byName.set(p.short_name.toLowerCase().trim(), p);
    }
  }

  return { byCode, byName };
}

/**
 * Detect price patterns in text. Returns the first detected price or null.
 * Matches: R1,024.07, R 500.00, R12345, or standalone decimal numbers >= 100
 */
function detectPrice(text: string): number | null {
  // Pattern 1: R followed by digits (with optional commas and decimals)
  const rPriceMatch = text.match(/R\s?([\d,]+(?:\.\d{1,2})?)/i);
  if (rPriceMatch) {
    const val = parseFloat(rPriceMatch[1].replace(/,/g, ""));
    if (!isNaN(val) && val >= 10) return val;
  }

  // Pattern 2: Standalone numbers that look like prices (≥100, with decimals, in rightmost text)
  const numberMatches = text.match(/(?:^|\s)([\d,]{3,}(?:\.\d{1,2}))(?:\s|$)/g);
  if (numberMatches) {
    for (const m of numberMatches) {
      const val = parseFloat(m.trim().replace(/,/g, ""));
      if (!isNaN(val) && val >= 100) return val;
    }
  }

  return null;
}

/**
 * Match extracted text rows against products database.
 * Returns positioned regions with matched/unmatched status.
 * Regions with price data are always included (even if unmatched).
 */
export function matchTextRowsToProducts(
  items: ExtractedTextItem[],
  pageWidth: number,
  pageHeight: number,
  products: PaletteProduct[]
): ExtractedProductRegion[] {
  const rows = groupTextItemsIntoRows(items);
  const { byCode, byName } = buildProductLookup(products);
  const regions: ExtractedProductRegion[] = [];

  for (const row of rows) {
    const rowText = row.map((i) => i.text).join(" ");
    const rowTextLower = rowText.toLowerCase();

    // Skip very short rows (likely headers, page numbers, etc.)
    if (rowText.length < 3) continue;

    // Try to match by product code first (most reliable)
    let matched: PaletteProduct | null = null;
    let matchedCode = "";

    for (const [code, product] of byCode) {
      if (code.length >= 3 && rowTextLower.includes(code)) {
        matched = product;
        matchedCode = product.product_code;
        break;
      }
    }

    // Fall back to short_name matching if no code match
    if (!matched) {
      for (const [name, product] of byName) {
        if (name.length >= 5 && rowTextLower.includes(name)) {
          matched = product;
          matchedCode = product.product_code;
          break;
        }
      }
    }

    // Detect price in the row text
    const detectedPrice = detectPrice(rowText);
    const hasPrice = detectedPrice !== null;

    // Skip rows that have no match AND no price data
    if (!matched && !hasPrice) continue;

    // Calculate bounding box for the entire row
    const minX = Math.min(...row.map((i) => i.x));
    const maxX = Math.max(...row.map((i) => i.x + i.width));
    const minY = Math.min(...row.map((i) => i.y));
    const maxY = Math.max(...row.map((i) => i.y + i.height));

    // Convert to percentage coordinates
    const x_pct = (minX / pageWidth) * 100;
    const y_pct = (minY / pageHeight) * 100;
    const w_pct = ((maxX - minX) / pageWidth) * 100;
    const h_pct = ((maxY - minY) / pageHeight) * 100;

    // Skip regions that are too narrow or positioned outside page
    if (w_pct < 1 || h_pct < 0.3) continue;
    if (x_pct < 0 || y_pct < 0 || x_pct > 100 || y_pct > 100) continue;

    regions.push({
      product: matched,
      product_code: matchedCode || rowText.substring(0, 30),
      label: rowText.substring(0, 80),
      x_pct: Math.max(0, x_pct),
      y_pct: Math.max(0, y_pct),
      w_pct: Math.min(100 - x_pct, w_pct),
      h_pct: Math.min(100 - y_pct, h_pct),
      matched: !!matched,
      has_price: hasPrice,
      detected_price: detectedPrice,
    });
  }

  return regions;
}

// Cache for extracted regions per page
const extractionCache = new Map<
  string,
  ExtractedProductRegion[]
>();

/**
 * Extract and match products from a PDF page, with caching.
 * Returns cached results if available for the same page + product set.
 */
export async function extractAndMatchPage(
  pdfUrl: string,
  pageNumber: number,
  products: PaletteProduct[]
): Promise<ExtractedProductRegion[]> {
  const cacheKey = `${pdfUrl}:${pageNumber}:${products.length}`;

  if (extractionCache.has(cacheKey)) {
    return extractionCache.get(cacheKey)!;
  }

  try {
    const { items, pageWidth, pageHeight } = await extractTextItemsFromPdfPage(
      pdfUrl,
      pageNumber
    );

    const regions = matchTextRowsToProducts(
      items,
      pageWidth,
      pageHeight,
      products
    );

    extractionCache.set(cacheKey, regions);
    return regions;
  } catch (err) {
    console.error("[pdfTextExtractor] Failed to extract:", err);
    return [];
  }
}

/**
 * Clear the extraction cache (e.g., when products change).
 */
export function clearExtractionCache() {
  extractionCache.clear();
}
