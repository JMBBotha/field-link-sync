/**
 * PDF Text Extraction & Product Matching Utility
 *
 * Uses pdfjs-dist to extract text items with their exact coordinates
 * from a PDF page, then cross-references against the products database.
 *
 * v16: PRICE-FIRST approach — every R-prefixed price gets an icon.
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
 * Build a lookup map from products for efficient matching.
 */
function buildProductLookup(products: PaletteProduct[]) {
  const byCode = new Map<string, PaletteProduct>();
  const byName = new Map<string, PaletteProduct>();
  const byDescription = new Map<string, PaletteProduct>();

  for (const p of products) {
    if (p.product_code) {
      byCode.set(p.product_code.toLowerCase().trim(), p);
    }
    if (p.short_name) {
      byName.set(p.short_name.toLowerCase().trim(), p);
    }
    if (p.description) {
      const descKey = p.description.split(" - ")[0].toLowerCase().trim();
      if (descKey.length >= 8 && !byDescription.has(descKey)) {
        byDescription.set(descKey, p);
      }
    }
  }

  return { byCode, byName, byDescription };
}

/**
 * Detect price patterns in text. Returns the first detected price or null.
 * Handles South African formats: R1,024.07, R 500.00, R150, R12,15, R 1 234,56
 * Only returns prices — rejects model codes like R32, R410A.
 */
function detectPrice(text: string): number | null {
  // Try decimal prices first (e.g. R1,738.26, R260.74, R12,15)
  const decimalMatch = text.match(/R\s*([\d\s,]+[.,]\d{1,2})\b/);
  if (decimalMatch) {
    let raw = decimalMatch[1].trim();
    if (/,\d{1,2}$/.test(raw) && !/\.\d/.test(raw)) {
      raw = raw.replace(/\s/g, "").replace(/,(?=\d{1,2}$)/, ".");
    } else {
      raw = raw.replace(/[,\s]/g, "");
    }
    const val = parseFloat(raw);
    if (!isNaN(val) && val >= 1) return val;
  }

  // Whole number prices >= 50, NOT followed by a letter (rejects R32W, R410A)
  const wholeMatch = text.match(/R\s*(\d{2,}(?:\s\d{3})*)(?![A-Za-z])/);
  if (wholeMatch) {
    const raw = wholeMatch[1].replace(/\s/g, "");
    const val = parseFloat(raw);
    if (!isNaN(val) && val >= 50) return val;
  }

  return null;
}

/** Check if a text item contains an R-prefixed price */
function isPriceItem(text: string): boolean {
  return detectPrice(text) !== null;
}

/**
 * PRICE-FIRST: Match extracted text against products database.
 *
 * 1. Find ALL price items
 * 2. Group prices into rows by Y proximity
 * 3. For each price row, gather all text on the same Y-line
 * 4. Match against product DB
 * 5. Dedup and align icons
 */
export function matchTextRowsToProducts(
  items: ExtractedTextItem[],
  pageWidth: number,
  pageHeight: number,
  products: PaletteProduct[]
): ExtractedProductRegion[] {
  if (items.length === 0 || pageHeight === 0) return [];

  const { byCode, byName, byDescription } = buildProductLookup(products);

  // ── STEP 1: Find all price items ──
  const priceItems: ExtractedTextItem[] = [];
  for (const item of items) {
    if (isPriceItem(item.text)) {
      priceItems.push(item);
    }
  }

  if (priceItems.length === 0) return [];

  console.log(`[pdfTextExtractor] Found ${priceItems.length} price items out of ${items.length} text items, ${products.length} products`);

  // ── STEP 2: Group price items into rows by Y proximity ──
  const sortedPrices = [...priceItems].sort((a, b) => a.y - b.y);

  // Adaptive threshold from price item gaps
  const gaps: number[] = [];
  for (let i = 1; i < sortedPrices.length; i++) {
    const gap = sortedPrices[i].y - sortedPrices[i - 1].y;
    if (gap > 0.5) gaps.push(gap);
  }
  gaps.sort((a, b) => a - b);
  const medianGap = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : 6;
  const yThreshold = Math.max(6, medianGap * 0.6);

  const priceRows: ExtractedTextItem[][] = [];
  let curRow: ExtractedTextItem[] = [sortedPrices[0]];
  let curY = sortedPrices[0].y;

  for (let i = 1; i < sortedPrices.length; i++) {
    if (sortedPrices[i].y - curY > yThreshold) {
      priceRows.push(curRow);
      curRow = [];
      curY = sortedPrices[i].y;
    }
    curRow.push(sortedPrices[i]);
  }
  if (curRow.length > 0) priceRows.push(curRow);

  console.log(`[pdfTextExtractor] Grouped into ${priceRows.length} price rows (threshold=${yThreshold.toFixed(1)})`);

  // ── STEP 3: For each price row, gather all text on same Y-line and build region ──
  const regions: ExtractedProductRegion[] = [];
  const seenCodes = new Set<string>();

  for (const pRow of priceRows) {
    // Rightmost price item = icon anchor
    const anchor = pRow.reduce((best, item) => (item.x > best.x ? item : best), pRow[0]);
    const anchorY = anchor.y;
    const anchorHeight = anchor.height;

    // Ghost filter: skip prices in top 3% that have no model code nearby
    const y_pct = (anchorY / pageHeight) * 100;
    if (y_pct < 3) {
      // Check if any text on this Y-line has a model code pattern
      const nearbyText = items
        .filter(it => Math.abs(it.y - anchorY) <= yThreshold)
        .map(it => it.text)
        .join(" ");
      if (!/\b[A-Z]{2,}\d+[A-Z0-9]*\b/i.test(nearbyText)) continue;
    }

    // Find ALL text items on same Y-line
    const rowItems = items
      .filter(it => Math.abs(it.y - anchorY) <= yThreshold)
      .sort((a, b) => a.x - b.x);

    const rowText = rowItems.map(it => it.text).join(" ");
    const rowTextLower = rowText.toLowerCase();

    if (rowText.trim().length < 3) continue;

    // Detect price from anchor
    const detectedPrice = detectPrice(anchor.text);

    // ── Try matching against product DB ──
    let matched: PaletteProduct | null = null;
    let matchedCode = "";

    for (const [code, product] of byCode) {
      if (code.length >= 3 && rowTextLower.includes(code)) {
        matched = product;
        matchedCode = product.product_code;
        break;
      }
    }

    if (!matched) {
      for (const [name, product] of byName) {
        if (name.length >= 5 && rowTextLower.includes(name)) {
          matched = product;
          matchedCode = product.product_code;
          break;
        }
      }
    }

    if (!matched) {
      for (const [desc, product] of byDescription) {
        if (desc.length >= 8 && rowTextLower.includes(desc)) {
          matched = product;
          matchedCode = product.product_code;
          break;
        }
      }
    }

    // Extract a code for dedup
    const extractedCode = matchedCode || (() => {
      const codeMatch = rowText.match(/\b([A-Z]{2,}\d+[A-Z0-9-]*)\b/);
      if (codeMatch) return codeMatch[1];
      const priceTag = detectedPrice ? `@${detectedPrice}` : "";
      return rowText.trim().substring(0, 80) + priceTag;
    })();

    // STEP 5a: Code dedup
    const codeKey = extractedCode.toLowerCase().trim();
    if (codeKey.length >= 3 && codeKey.length < 40 && seenCodes.has(codeKey)) continue;
    if (codeKey.length >= 3 && codeKey.length < 40) seenCodes.add(codeKey);

    // STEP 4: Position
    const h_pct = Math.max((anchorHeight / pageHeight) * 100, 1.5);
    if (y_pct < 0 || y_pct > 100 || h_pct > 5) continue;

    const label = rowText.trim().substring(0, 200);
    if (!label || label.length < 2) continue;

    regions.push({
      product: matched,
      product_code: extractedCode,
      label,
      x_pct: 95,
      y_pct: Math.max(0, y_pct),
      w_pct: 4,
      h_pct: Math.min(100 - y_pct, h_pct),
      matched: !!matched,
      has_price: true,
      detected_price: detectedPrice,
    });
  }

  // ── STEP 5b: Y-bucket dedup ──
  const yBuckets = new Map<number, number>();
  const deduped: ExtractedProductRegion[] = [];
  for (let i = 0; i < regions.length; i++) {
    const bucket = Math.round(regions[i].y_pct / 0.5) * 0.5;
    const existing = yBuckets.get(bucket);
    if (existing !== undefined) {
      if (regions[i].matched && !deduped[existing].matched) {
        deduped[existing] = regions[i];
      }
    } else {
      yBuckets.set(bucket, deduped.length);
      deduped.push(regions[i]);
    }
  }

  // ── STEP 6: Align all icons to a single x column ──
  if (deduped.length > 0) {
    const maxX = Math.max(...deduped.map(r => r.x_pct));
    for (const r of deduped) {
      r.x_pct = maxX;
    }
  }

  const matchedCount = deduped.filter(r => r.matched).length;
  console.log(`[pdfTextExtractor] Results: ${deduped.length} regions (${matchedCount} matched, ${deduped.length - matchedCount} unmatched)`);

  return deduped;
}

// Cache for extracted regions per page
let _extractionVersion = 16; // v16: price-first approach
const extractionCache = new Map<string, ExtractedProductRegion[]>();

/**
 * Extract and match products from a PDF page, with caching.
 */
export async function extractAndMatchPage(
  pdfUrl: string,
  pageNumber: number,
  products: PaletteProduct[]
): Promise<ExtractedProductRegion[]> {
  const cacheKey = `v${_extractionVersion}:${pdfUrl}:${pageNumber}:${products.length}`;

  if (extractionCache.has(cacheKey)) {
    return extractionCache.get(cacheKey)!;
  }

  try {
    const { items, pageWidth, pageHeight } = await extractTextItemsFromPdfPage(
      pdfUrl,
      pageNumber
    );

    const regions = matchTextRowsToProducts(items, pageWidth, pageHeight, products);
    extractionCache.set(cacheKey, regions);
    return regions;
  } catch (err) {
    console.error("[pdfTextExtractor] Failed to extract:", err);
    return [];
  }
}

/**
 * Clear the extraction cache. Bumps version to bust stale entries.
 */
export function clearExtractionCache() {
  extractionCache.clear();
  _extractionVersion++;
}
