/**
 * PDF Text Extraction & Product Matching Utility
 *
 * Uses pdfjs-dist to extract text items with their exact coordinates
 * from a PDF page, then cross-references against the products database.
 *
 * v24: Unified price-first approach with avgHeight-based adaptive threshold.
 */
import type { PaletteProduct } from "../QuoteBuilderTab";
/**
 * Sanitize PDF URL by trimming trailing spaces from path segments.
 * Fixes 400 errors from storage when supplier names have trailing spaces.
 */
function sanitizePdfUrl(url: string): string {
  try {
    const u = new URL(url);
    // Decode, trim each segment, re-encode
    u.pathname = u.pathname
      .split("/")
      .map(seg => decodeURIComponent(seg).trim())
      .map(seg => encodeURIComponent(seg))
      .join("/");
    return u.toString();
  } catch {
    // Fallback: simple regex to remove %20 before /
    return url.replace(/%20\//g, "/").replace(/ \//g, "/");
  }
}
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
  // Sanitize URL: fix trailing spaces in path segments (e.g. "Samsung /" → "Samsung/")
  const sanitizedUrl = sanitizePdfUrl(pdfUrl);
  const loadingTask = pdfjsLib.getDocument({
    url: sanitizedUrl,
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
 * Merge lone "R" currency symbols with adjacent price digits on the same row.
 * Handles table-layout PDFs where pdfjs-dist splits "R" and "172,79" into separate items.
 */
export function mergeCurrencyWithPrices(items: ExtractedTextItem[]): ExtractedTextItem[] {
  // Sort by y then x
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const result: ExtractedTextItem[] = [];
  const skip = new Set<number>();
  // Adaptive Y-threshold: use average text height, minimum 8px
  const avgHeight = sorted.length > 0
    ? sorted.reduce((sum, i) => sum + i.height, 0) / sorted.length
    : 10;
  const yThreshold = Math.max(avgHeight * 1.2, 8);
  for (let i = 0; i < sorted.length; i++) {
    if (skip.has(i)) continue;
    const item = sorted[i];
    // Match lone "R" currency symbol (trim handles trailing whitespace)
    const trimmed = item.text.trim();
    if (trimmed === "R" || trimmed === "R ") {
      // Find the next item to the right on the same row
      let bestJ = -1;
      for (let j = i + 1; j < sorted.length; j++) {
        if (Math.abs(sorted[j].y - item.y) > yThreshold) continue; // same row check
        if (sorted[j].x < item.x + item.width - 2) continue; // must be to the right
        // Check no other item sits between them horizontally on the same row
        const gap = sorted[j].x - (item.x + item.width);
        if (gap > item.width * 4) continue; // too far away
        const nextText = sorted[j].text.trim();
        // Must look like price digits: starts with digit, contains digits/spaces/commas/periods
        if (!/^\d[\d\s,.]*$/.test(nextText)) continue;
        // Must have comma/period OR be a multi-digit number (avoid "410" in R410 refrigerant)
        if (!/[,.]/.test(nextText) && nextText.replace(/\s/g, "").length < 4) continue;
        bestJ = j;
        break;
      }
      if (bestJ >= 0) {
        const next = sorted[bestJ];
        result.push({
          text: "R" + next.text,
          x: item.x,
          y: item.y,
          width: (next.x + next.width) - item.x,
          height: Math.max(item.height, next.height),
        });
        skip.add(i);
        skip.add(bestJ);
        continue;
      }
    }
    result.push(item);
  }
  return result;
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
 * Detect price in text. Returns the numeric value or null.
 * Handles SA formats: R1,024.07, R 500.00, R150, R12,15, R 1 234,56
 */
function detectPrice(text: string): number | null {
  const prices = detectAllPrices(text);
  return prices.length > 0 ? prices[prices.length - 1] : null;
}
/** Find ALL R-prefixed prices in a string, returned in order of appearance */
function detectAllPrices(text: string): number[] {
  const results: number[] = [];
  const re = /R\s*([\d\s,]+[.,]\d{1,2})(?:\s|$|[^A-Za-z0-9]|,)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const val = parseRawPrice(m[1]);
    if (val !== null) results.push(val);
  }
  const re2 = /R\s*([\d\s,]+[.,]\d{1,2})$/g;
  while ((m = re2.exec(text)) !== null) {
    const val = parseRawPrice(m[1]);
    if (val !== null && !results.includes(val)) results.push(val);
  }
  // Whole number prices >= 50
  const re3 = /R\s*(\d[\d\s]*)(?![A-Za-z])/g;
  while ((m = re3.exec(text)) !== null) {
    const raw = m[1].replace(/\s/g, "");
    const val = parseFloat(raw);
    if (!isNaN(val) && val >= 50 && !results.includes(val)) results.push(val);
  }
  return results;
}
function parseRawPrice(captured: string): number | null {
  let raw = captured.trim();
  if (/,\d{1,2}$/.test(raw) && !/\.\d/.test(raw)) {
    raw = raw.replace(/\s/g, "").replace(/,(?=\d{1,2}$)/, ".");
  } else {
    raw = raw.replace(/[,\s]/g, "");
  }
  const val = parseFloat(raw);
  if (!isNaN(val) && val > 0) return val;
  return null;
}
/** Check if a text item contains an R-prefixed price */
function isPriceItem(text: string): boolean {
  return detectPrice(text) !== null;
}
/**
 * Merge adjacent text items where "R" or "R<digits>" is followed by a numeric
 * continuation on the same Y-line.
 */
function mergeAdjacentPriceFragments(
  items: ExtractedTextItem[],
  yThreshold: number
): ExtractedTextItem[] {
  const merged: ExtractedTextItem[] = [];
  const used = new Set<number>();
  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue;
    const item = items[i];
    const trimmed = item.text.trim();
    if (/^R\d*$/i.test(trimmed) && !isPriceItem(item.text)) {
      let bestJ = -1;
      let bestDist = Infinity;
      for (let j = 0; j < items.length; j++) {
        if (j === i || used.has(j)) continue;
        if (Math.abs(items[j].y - item.y) > yThreshold) continue;
        const dist = items[j].x - (item.x + item.width);
        if (dist >= -2 && dist < bestDist) {
          const jText = items[j].text.trim();
          if (/^[\d\s,.][\d\s,.]+$/.test(jText)) {
            bestJ = j;
            bestDist = dist;
          }
        }
      }
      if (bestJ >= 0 && bestDist < item.width * 2) {
        const combined = item.text.trim() + " " + items[bestJ].text.trim();
        if (isPriceItem(combined)) {
          merged.push({
            text: combined,
            x: item.x,
            y: item.y,
            width: (items[bestJ].x + items[bestJ].width) - item.x,
            height: Math.max(item.height, items[bestJ].height),
          });
          used.add(i);
          used.add(bestJ);
          continue;
        }
      }
    }
    merged.push(item);
  }
  return merged;
}
/**
 * Find price column x-range by locating header text like "PRICE", "EXCL", "INCL"
 * near the top of the page. Returns {minX, maxX} or null.
 */
function findPriceColumnRange(
  items: ExtractedTextItem[],
  pageWidth: number,
  pageHeight: number
): { minX: number; maxX: number } | null {
  // Look at items in top 15% of page for column headers
  const headerItems = items.filter((i) => i.y / pageHeight < 0.15);
  const priceHeaders = headerItems.filter((i) => {
    const t = i.text.trim().toUpperCase();
    return t.includes("PRICE") || t === "EXCL" || t.includes("EXCL VAT") || t.includes("INCL VAT");
  });
  if (priceHeaders.length === 0) return null;
  // Use the rightmost price-related header
  priceHeaders.sort((a, b) => b.x - a.x);
  const header = priceHeaders[0];
  return { minX: header.x - 20, maxX: header.x + header.width + 30 };
}
/**
 * COLUMN-BASED price detection: find numeric items in the price column area,
 * or fallback to right-side heuristic (x > 55% of page width).
 */
function findColumnPrices(
  items: ExtractedTextItem[],
  pageWidth: number,
  pageHeight: number
): ExtractedTextItem[] {
  const colRange = findPriceColumnRange(items, pageWidth, pageHeight);
  const candidates: ExtractedTextItem[] = [];
  for (const item of items) {
    const t = item.text.trim();
    // Must be numeric-ish: digits with optional spaces/commas/periods
    if (!/^\d[\d\s,.]*$/.test(t)) continue;
    // Must have at least 2 digits total
    const digits = t.replace(/[\s,.]/g, "");
    if (digits.length < 2) continue;
    // Parse as price value
    let raw = t.replace(/\s/g, "");
    if (/,\d{1,2}$/.test(raw) && !/\.\d/.test(raw)) {
      raw = raw.replace(/,(?=\d{1,2}$)/, ".");
    } else {
      raw = raw.replace(/,/g, "");
    }
    const val = parseFloat(raw);
    if (isNaN(val) || val < 1) continue;
    // Check if in price column or right side of page
    const inColumn = colRange && item.x >= colRange.minX && item.x <= colRange.maxX;
    const inRightSide = item.x / pageWidth > 0.40;
    if (inColumn || inRightSide) {
      candidates.push(item);
    }
  }
  return candidates;
}
/**
 * PRICE-FIRST approach v29: column-based detection for dense table PDFs.
 * Combines R-prefixed prices with column-position-based numeric prices.
 */
export function matchTextRowsToProducts(
  items: ExtractedTextItem[],
  pageWidth: number,
  pageHeight: number,
  products: PaletteProduct[]
): ExtractedProductRegion[] {
  if (items.length === 0 || pageHeight === 0) return [];
  const lookup = buildProductLookup(products);
  const { byCode, byName, byDescription } = lookup;
  const mergedItems = mergeAdjacentPriceFragments(items, 3);
  // Adaptive Y-threshold
  const avgHeight =
    mergedItems.reduce((sum, i) => sum + i.height, 0) / mergedItems.length || 10;
  const yThreshold = Math.max(avgHeight * 1.5, 8);
  // STEP 1a: Explicit R-prefixed prices (works for Samsung/Daikin/Midea)
  const explicitPriceItems = mergedItems.filter(
    (item) => /R\s*\d/.test(item.text) && detectPrice(item.text) !== null
  );
  // STEP 1b: Column-based numeric prices (works for dense table PDFs like One Stop)
  const columnPrices = findColumnPrices(mergedItems, pageWidth, pageHeight);
  // Combine and deduplicate by position
  const seen = new Set<string>();
  const priceItems: ExtractedTextItem[] = [];
  for (const item of [...explicitPriceItems, ...columnPrices]) {
    const key = `${item.x.toFixed(0)},${item.y.toFixed(0)}`;
    if (!seen.has(key)) {
      seen.add(key);
      priceItems.push(item);
    }
  }
  const colRange = findPriceColumnRange(mergedItems, pageWidth, pageHeight);
  console.log(`[pdfExtract] matchTextRows: ${mergedItems.length} items, yThreshold=${yThreshold.toFixed(1)}, explicit R-prices=${explicitPriceItems.length}, column-based prices=${columnPrices.length}, combined unique=${priceItems.length}, priceColumnRange=${colRange ? `${colRange.minX.toFixed(0)}-${colRange.maxX.toFixed(0)}` : 'none (using x>40% fallback)'}, pageWidth=${pageWidth.toFixed(0)}`);
  if (priceItems.length === 0) return [];
  // STEP 2: Create one row per individual price item (no grouping).
  // Previous grouping merged adjacent product rows into single blocks.
  // Each price item gets its own row to ensure one icon per priced product row.
  const sortedPrices = [...priceItems].sort((a, b) => a.y - b.y);
  const priceRows: { items: ExtractedTextItem[] }[] = sortedPrices.map(p => ({ items: [p] }));
  // Model code regex - broad enough for Samsung, Daikin, Midea
  const modelRegex = /^[A-Za-z0-9\-\/]{5,}$/;
  // STEP 3: For each price row, gather context and build a region
  // IMPROVED MATCHING – TIGHT ROW + POSITION-AWARE + DEDUP
  const regions: ExtractedProductRegion[] = [];
  let skippedCount = { noPrice: 0, ghost: 0, outOfBounds: 0 };
  const assignedCodes = new Set<string>();
  // Build a flat list of all product codes for candidate scanning
  const allProductCodes = [...byCode.keys()];
  for (const pRow of priceRows) {
    const rightmost = pRow.items[pRow.items.length - 1];
    // Try explicit R-prefixed price first, then raw numeric parse for column-based items
    let detectedPrice = detectPrice(rightmost.text);
    if (detectedPrice === null) {
      let raw = rightmost.text.trim().replace(/\s/g, "");
      if (/,\d{1,2}$/.test(raw) && !/\.\d/.test(raw)) {
        raw = raw.replace(/,(?=\d{1,2}$)/, ".");
      } else {
        raw = raw.replace(/,/g, "");
      }
      const val = parseFloat(raw);
      if (!isNaN(val) && val >= 1) detectedPrice = val;
    }
    if (detectedPrice === null || detectedPrice <= 0) {
      skippedCount.noPrice++;
      continue;
    }
    const rowAvgY = pRow.items.reduce((s, i) => s + i.y, 0) / pRow.items.length;
    // Ghost filter: skip if in top 3% AND no model code nearby
    const y_pct = (rowAvgY / pageHeight) * 100;
    // TIGHT same-row context ONLY (no aboveItems, no wide band)
    const tightBand = avgHeight * 0.6;
    const contextItems = mergedItems.filter(
      (it) => Math.abs(it.y - rowAvgY) <= tightBand
    );
    const hasModel = contextItems.some((i) => modelRegex.test(i.text.trim()));
    if (y_pct < 3 && !hasModel) { skippedCount.ghost++; continue; }
    const rowText = contextItems.map((it) => it.text).join(" ");
    const matchTextLower = rowText.toLowerCase();
    // POSITION-AWARE matching: find candidate codes in this row's items, sorted left-to-right
    const candidates: { code: string; product: PaletteProduct; x: number }[] = [];
    for (const it of contextItems) {
      const itLower = it.text.toLowerCase();
      for (const [code, product] of byCode) {
        if (code.length >= 3 && itLower.includes(code)) {
          candidates.push({ code, product, x: it.x });
        }
      }
    }
    // Sort leftmost first – prefer codes physically left of the price
    candidates.sort((a, b) => a.x - b.x);
    let matched: PaletteProduct | null = null;
    let matchedCode = "";
    // Pick leftmost candidate that hasn't been assigned yet (or genuinely appears multiple times)
    for (const cand of candidates) {
      const occurrences = contextItems.filter((i) => i.text.toLowerCase().includes(cand.code)).length;
      if (!assignedCodes.has(cand.code) || occurrences > 1) {
        matched = cand.product;
        matchedCode = cand.product.product_code;
        assignedCodes.add(cand.code);
        break;
      }
    }
    // Fallback: try byName then byDescription (loose, but still row-scoped)
    if (!matched) {
      for (const [name, product] of byName) {
        if (name.length >= 5 && matchTextLower.includes(name)) {
          if (!assignedCodes.has(name)) {
            matched = product;
            matchedCode = product.product_code;
            assignedCodes.add(name);
            break;
          }
        }
      }
    }
    if (!matched) {
      for (const [desc, product] of byDescription) {
        if (desc.length >= 8 && matchTextLower.includes(desc)) {
          matched = product;
          matchedCode = product.product_code;
          break;
        }
      }
    }
    const extractedCode =
      matchedCode ||
      (() => {
        const codeMatch = contextItems.map((it) => it.text).join(" ").match(/\b([A-Za-z]{2,}\d+[A-Za-z0-9\-]*)\b/);
        return codeMatch
          ? codeMatch[1]
          : rowText.trim().substring(0, 80) + `@${detectedPrice}`;
      })();
    const anchorHeight = rightmost.height;
    const h_pct = Math.max((anchorHeight / pageHeight) * 100, 1.5);
    if (y_pct > 100 || h_pct > 5) { skippedCount.outOfBounds++; continue; }
    // Use ACTUAL price item coordinates for icon alignment (not hardcoded)
    const actualX_pct = (rightmost.x / pageWidth) * 100;
    const actualW_pct = Math.max((rightmost.width / pageWidth) * 100, 2);
    regions.push({
      product: matched,
      product_code: extractedCode,
      label: rowText.trim().substring(0, 200),
      x_pct: actualX_pct,
      y_pct: Math.max(0, y_pct),
      w_pct: actualW_pct,
      h_pct: Math.min(100 - y_pct, h_pct),
      matched: !!matched,
      has_price: true,
      detected_price: detectedPrice,
    });
  }
  console.log(`[pdfExtract] Row processing: ${priceRows.length} price rows → ${regions.length} regions. Skipped: noPrice=${skippedCount.noPrice}, ghost=${skippedCount.ghost}, outOfBounds=${skippedCount.outOfBounds}`);
  // Align all icons to a single X column
  if (regions.length > 0) {
    const maxX = Math.max(...regions.map((r) => r.x_pct));
    for (const r of regions) r.x_pct = maxX;
  }
  return regions;
}
// Cache for extracted regions per page
let _extractionVersion = 34; // v34: actual price coordinates for icon alignment
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
    console.log(`[pdfExtract] Page ${pageNumber}: ${items.length} raw text items extracted from PDF`);
    const mergedItems = mergeCurrencyWithPrices(items);
    console.log(`[pdfExtract] Page ${pageNumber}: ${mergedItems.length} items after mergeCurrencyWithPrices (${items.length - mergedItems.length} merged)`);
    // Log sample of lone "R" items and standalone numeric items for debugging
    const loneRItems = mergedItems.filter(i => i.text.trim() === "R");
    const numericItems = mergedItems.filter(i => /^\d[\d\s,.]+$/.test(i.text.trim()));
    console.log(`[pdfExtract] Page ${pageNumber}: ${loneRItems.length} lone "R" items, ${numericItems.length} standalone numeric items`);
    if (loneRItems.length > 0 && loneRItems.length <= 5) {
      loneRItems.forEach(r => console.log(`[pdfExtract] R at x=${r.x.toFixed(1)} y=${r.y.toFixed(1)}`));
    }
    const regions = matchTextRowsToProducts(mergedItems, pageWidth, pageHeight, products);
    console.log(`[pdfExtract] Page ${pageNumber}: ${regions.length} final regions`);
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
