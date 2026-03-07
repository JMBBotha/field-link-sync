/**
 * PDF Text Extraction & Product Matching Utility
 *
 * Uses pdfjs-dist to extract text items with their exact coordinates
 * from a PDF page, then cross-references against the products database.
 *
 * v34: Wider currency merge, lower column threshold, density-adaptive matching,
 *      standalone numeric detection, relaxed ghost filter, per-row logging.
 */
import type { PaletteProduct } from "../QuoteBuilderTab";

/**
 * Sanitize PDF URL by trimming trailing spaces from path segments.
 * Fixes 400 errors from storage when supplier names have trailing spaces.
 */
function sanitizePdfUrl(url: string): string {
  try {
    const u = new URL(url);
    u.pathname = u.pathname
      .split("/")
      .map(seg => decodeURIComponent(seg).trim())
      .map(seg => encodeURIComponent(seg))
      .join("/");
    return u.toString();
  } catch {
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
 * v34: yThreshold = avgHeight * 1.5, gap relaxed to *6, distance penalty for y diff.
 */
export function mergeCurrencyWithPrices(items: ExtractedTextItem[]): ExtractedTextItem[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const result: ExtractedTextItem[] = [];
  const skip = new Set<number>();

  const avgHeight = sorted.length > 0
    ? sorted.reduce((sum, i) => sum + i.height, 0) / sorted.length
    : 10;
  const yThreshold = Math.max(avgHeight * 1.5, 8);

  for (let i = 0; i < sorted.length; i++) {
    if (skip.has(i)) continue;
    const item = sorted[i];

    const trimmed = item.text.trim();
    // Match lone "R" or "R " (startsWith 'R' with length <= 2)
    if (trimmed.startsWith("R") && trimmed.length <= 2) {
      let bestJ = -1;
      let bestScore = Infinity;
      for (let j = i + 1; j < sorted.length; j++) {
        if (skip.has(j)) continue;
        const dy = Math.abs(sorted[j].y - item.y);
        if (dy > yThreshold) continue;
        if (sorted[j].x < item.x + item.width - 2) continue;
        const gap = sorted[j].x - (item.x + item.width);
        if (gap > item.width * 6) continue; // relaxed from *4
        const nextText = sorted[j].text.trim();
        if (!/^\d[\d\s,.]*$/.test(nextText)) continue;
        if (!/[,.]/.test(nextText) && nextText.replace(/\s/g, "").length < 4) continue;
        // Distance penalty: dx + dy*2 (penalize vertical offset)
        const score = gap + dy * 2;
        if (score < bestScore) {
          bestJ = j;
          bestScore = score;
        }
      }

      if (bestJ >= 0) {
        const next = sorted[bestJ];
        const mergedText = "R" + next.text;
        console.log(`[pdfExtract] R-merge: "R" at (${item.x.toFixed(0)},${item.y.toFixed(0)}) + "${next.text.trim()}" at (${next.x.toFixed(0)},${next.y.toFixed(0)}) → "${mergedText.trim()}" score=${bestScore.toFixed(1)}`);
        result.push({
          text: mergedText,
          x: item.x,
          y: item.y,
          width: (next.x + next.width) - item.x,
          height: Math.max(item.height, next.height),
        });
        skip.add(i);
        skip.add(bestJ);
        continue;
      } else {
        console.log(`[pdfExtract] R-merge FAIL: lone "R" at (${item.x.toFixed(0)},${item.y.toFixed(0)}) — no numeric neighbor found within yThreshold=${yThreshold.toFixed(1)}, gap limit=${(item.width * 6).toFixed(0)}`);
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

/**
 * Find ALL R-prefixed prices in a string, returned in order of appearance.
 * ONLY matches explicit R-prefixed prices — no standalone numerics.
 */
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

/**
 * Parse a raw price string into a number.
 * Better handling of mixed formats: if comma before last 2 digits AND period present,
 * treat period as thousands separator.
 */
function parseRawPrice(captured: string): number | null {
  let raw = captured.trim();
  // Mixed format: "1.234,56" — period is thousands, comma is decimal
  if (/,\d{1,2}$/.test(raw) && /\.\d/.test(raw)) {
    raw = raw.replace(/\s/g, "").replace(/\./g, "").replace(/,(?=\d{1,2}$)/, ".");
  } else if (/,\d{1,2}$/.test(raw) && !/\.\d/.test(raw)) {
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
 * v34: Widened range from -20/+30 to -30/+40.
 */
function findPriceColumnRange(
  items: ExtractedTextItem[],
  pageWidth: number,
  pageHeight: number
): { minX: number; maxX: number } | null {
  const headerItems = items.filter((i) => i.y / pageHeight < 0.15);
  const priceHeaders = headerItems.filter((i) => {
    const t = i.text.trim().toUpperCase();
    return t.includes("PRICE") || t === "EXCL" || t.includes("EXCL VAT") || t.includes("INCL VAT");
  });
  if (priceHeaders.length === 0) return null;
  priceHeaders.sort((a, b) => b.x - a.x);
  const header = priceHeaders[0];
  return { minX: header.x - 30, maxX: header.x + header.width + 40 };
}

/**
 * COLUMN-BASED price detection: find numeric items in the price column area,
 * or fallback to right-side heuristic.
 * v34: Lowered threshold from x > 40% to x > 30%.
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
    if (!/^\d[\d\s,.]*$/.test(t)) continue;
    const digits = t.replace(/[\s,.]/g, "");
    if (digits.length < 2) continue;

    let raw = t.replace(/\s/g, "");
    if (/,\d{1,2}$/.test(raw) && !/\.\d/.test(raw)) {
      raw = raw.replace(/,(?=\d{1,2}$)/, ".");
    } else {
      raw = raw.replace(/,/g, "");
    }
    const val = parseFloat(raw);
    if (isNaN(val) || val < 1) continue;

    const inColumn = colRange && item.x >= colRange.minX && item.x <= colRange.maxX;
    const inRightSide = item.x / pageWidth > 0.30; // lowered from 0.40

    if (inColumn || inRightSide) {
      candidates.push(item);
    }
  }

  return candidates;
}

/**
 * Determine if a row looks like a header rather than a product row.
 */
function isHeaderRow(text: string): boolean {
  const t = text.trim();
  // All uppercase text
  if (t === t.toUpperCase() && /[A-Z]{3,}/.test(t)) return true;
  // Contains price-related header words
  if (/\bPRICE\b|\bEXCL\b|\bINCL\b|\bMODEL\b|\bDESCRIPTION\b/i.test(t)) return true;
  // Very short text (< 10 chars)
  if (t.length < 10) return true;
  return false;
}

/**
 * PRICE-FIRST approach v35: rightmost R-price per row, no standalone numerics,
 * product-code-aware ghost filter, per-row logging.
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

  // Adaptive Y-threshold based on density
  const avgHeight =
    mergedItems.reduce((sum, i) => sum + i.height, 0) / mergedItems.length || 10;
  const itemDensity = mergedItems.length / (pageHeight / avgHeight);
  const isDense = itemDensity > 0.5;
  const yThreshold = isDense
    ? Math.max(avgHeight * 1.2, 8)
    : Math.max(avgHeight * 1.5, 8);

  console.log(`[pdfExtract] Density analysis: ${mergedItems.length} items, avgHeight=${avgHeight.toFixed(1)}, density=${itemDensity.toFixed(2)}, isDense=${isDense}, yThreshold=${yThreshold.toFixed(1)}`);

  // STEP 1: Find ALL explicit R-prefixed price items ONLY (no standalone numerics)
  const explicitPriceItems = mergedItems.filter(
    (item) => /R\s*\d/.test(item.text) && detectPrice(item.text) !== null
  );

  console.log(`[pdfExtract] matchTextRows: ${mergedItems.length} items, explicit R-prices=${explicitPriceItems.length}, pageWidth=${pageWidth.toFixed(0)}`);

  if (explicitPriceItems.length === 0) return [];

  // STEP 2: Group R-prefixed price items by y-position (same row = y within avgHeight*1.2)
  const rowGroupYThreshold = avgHeight * 1.2;
  const priceRowGroups: ExtractedTextItem[][] = [];
  const sortedPrices = [...explicitPriceItems].sort((a, b) => a.y - b.y);

  for (const item of sortedPrices) {
    let addedToGroup = false;
    for (const group of priceRowGroups) {
      const groupY = group[0].y;
      if (Math.abs(item.y - groupY) <= rowGroupYThreshold) {
        group.push(item);
        addedToGroup = true;
        break;
      }
    }
    if (!addedToGroup) {
      priceRowGroups.push([item]);
    }
  }

  // STEP 3: Keep ONLY the RIGHTMOST R-prefixed price per row (this is the INCL VAT price)
  const rightmostPricePerRow: ExtractedTextItem[] = priceRowGroups.map(group => {
    group.sort((a, b) => b.x - a.x); // sort by x descending
    const rightmost = group[0];
    if (group.length > 1) {
      console.log(`[pdfExtract] Row at y≈${rightmost.y.toFixed(0)}: ${group.length} R-prices, keeping rightmost "${rightmost.text.trim()}" at x=${rightmost.x.toFixed(0)} (INCL VAT)`);
    }
    return rightmost;
  });

  console.log(`[pdfExtract] ${priceRowGroups.length} price row groups → ${rightmostPricePerRow.length} rightmost prices`);

  const modelRegex = /^[A-Za-z0-9\-\/]{5,}$/;
  const productCodeRegex = /^[A-Z]{2}\d/;

  // STEP 4: For each price row, gather context and build a region
  const regions: ExtractedProductRegion[] = [];
  let skippedCount = { noPrice: 0, ghost: 0, outOfBounds: 0 };
  const assignedCodes = new Set<string>();

  // Adaptive tightBand based on density
  const tightBand = isDense ? avgHeight * 0.6 : avgHeight * 0.9;

  for (const rightmost of rightmostPricePerRow) {
    const detectedPrice = detectPrice(rightmost.text);
    if (detectedPrice === null || detectedPrice <= 0) {
      console.log(`[pdfExtract] SKIP row (noPrice): text="${rightmost.text.trim()}" at y=${rightmost.y.toFixed(1)}`);
      skippedCount.noPrice++;
      continue;
    }

    const rowAvgY = rightmost.y;
    const y_pct = (rowAvgY / pageHeight) * 100;

    // Context items on the same row
    const contextItems = mergedItems.filter(
      (it) => Math.abs(it.y - rowAvgY) <= tightBand
    );

    const rowText = contextItems.map((it) => it.text).join(" ");

    // Ghost filter: skip if in top 5% AND is a header row
    // BUT: never skip if the row has a product code matching /^[A-Z]{2}\d/
    const hasModel = contextItems.some((i) => modelRegex.test(i.text.trim()));
    const hasProductCode = contextItems.some((i) => productCodeRegex.test(i.text.trim()));
    if (y_pct < 5 && !hasModel && !hasProductCode && isHeaderRow(rowText)) {
      console.log(`[pdfExtract] SKIP row (ghost/header): y_pct=${y_pct.toFixed(1)}%, text="${rowText.trim().substring(0, 80)}"`);
      skippedCount.ghost++;
      continue;
    }

    const matchTextLower = rowText.toLowerCase();

    // POSITION-AWARE matching
    const candidates: { code: string; product: PaletteProduct; x: number }[] = [];
    for (const it of contextItems) {
      const itLower = it.text.toLowerCase();
      for (const [code, product] of byCode) {
        if (code.length >= 3 && itLower.includes(code)) {
          candidates.push({ code, product, x: it.x });
        }
      }
    }
    candidates.sort((a, b) => a.x - b.x);

    let matched: PaletteProduct | null = null;
    let matchedCode = "";

    for (const cand of candidates) {
      const occurrences = contextItems.filter((i) => i.text.toLowerCase().includes(cand.code)).length;
      if (!assignedCodes.has(cand.code) || occurrences > 1) {
        matched = cand.product;
        matchedCode = cand.product.product_code;
        assignedCodes.add(cand.code);
        break;
      }
    }

    // Fallback: try byName then byDescription
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
    if (y_pct > 100 || h_pct > 5) {
      console.log(`[pdfExtract] SKIP row (outOfBounds): y_pct=${y_pct.toFixed(1)}%, h_pct=${h_pct.toFixed(1)}%, code="${extractedCode}"`);
      skippedCount.outOfBounds++;
      continue;
    }

    console.log(`[pdfExtract] ADD region: y_pct=${y_pct.toFixed(1)}%, price=R${detectedPrice}, code="${extractedCode}", matched=${!!matched}, label="${rowText.trim().substring(0, 60)}"`);

    regions.push({
      product: matched,
      product_code: extractedCode,
      label: rowText.trim().substring(0, 200),
      x_pct: 95,
      y_pct: Math.max(0, y_pct),
      w_pct: 4,
      h_pct: Math.min(100 - y_pct, h_pct),
      matched: !!matched,
      has_price: true,
      detected_price: detectedPrice,
    });
  }

  console.log(`[pdfExtract] Row processing: ${rightmostPricePerRow.length} price rows → ${regions.length} regions. Skipped: noPrice=${skippedCount.noPrice}, ghost=${skippedCount.ghost}, outOfBounds=${skippedCount.outOfBounds}`);

  // Align all icons to a single X column
  if (regions.length > 0) {
    const maxX = Math.max(...regions.map((r) => r.x_pct));
    for (const r of regions) r.x_pct = maxX;
  }

  return regions;
}

// Cache for extracted regions per page
let _extractionVersion = 34; // v34: density-adaptive, standalone numerics, relaxed ghost, per-row logging
const extractionCache = new Map<string, { regions: ExtractedProductRegion[]; fullText: string }>();

export interface ExtractionResult {
  regions: ExtractedProductRegion[];
  fullText: string;
}

/**
 * Extract and match products from a PDF page, with caching.
 */
export async function extractAndMatchPage(
  pdfUrl: string,
  pageNumber: number,
  products: PaletteProduct[]
): Promise<ExtractedProductRegion[]> {
  const result = await extractAndMatchPageFull(pdfUrl, pageNumber, products);
  return result.regions;
}

/**
 * Full extraction returning both regions and fullText for cross-check validation.
 */
export async function extractAndMatchPageFull(
  pdfUrl: string,
  pageNumber: number,
  products: PaletteProduct[]
): Promise<ExtractionResult> {
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

    const fullText = items.map(i => i.text).join(' ');

    const mergedItems = mergeCurrencyWithPrices(items);
    console.log(`[pdfExtract] Page ${pageNumber}: ${mergedItems.length} items after mergeCurrencyWithPrices (${items.length - mergedItems.length} merged)`);

    const loneRItems = mergedItems.filter(i => i.text.trim() === "R");
    const numericItems = mergedItems.filter(i => /^\d[\d\s,.]+$/.test(i.text.trim()));
    console.log(`[pdfExtract] Page ${pageNumber}: ${loneRItems.length} lone "R" items, ${numericItems.length} standalone numeric items`);
    if (loneRItems.length > 0 && loneRItems.length <= 5) {
      loneRItems.forEach(r => console.log(`[pdfExtract]   R at x=${r.x.toFixed(1)} y=${r.y.toFixed(1)}`));
    }

    const regions = matchTextRowsToProducts(mergedItems, pageWidth, pageHeight, products);
    console.log(`[pdfExtract] Page ${pageNumber}: ${regions.length} final regions`);
    const result = { regions, fullText };
    extractionCache.set(cacheKey, result);
    return result;
  } catch (err) {
    console.error("[pdfTextExtractor] Failed to extract:", err);
    return { regions: [], fullText: "" };
  }
}

/**
 * Clear the extraction cache. Bumps version to bust stale entries.
 */
export function clearExtractionCache() {
  extractionCache.clear();
  _extractionVersion++;
}
