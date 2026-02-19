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
  // Find ALL R-prefixed prices and return the last (rightmost) one
  const prices = detectAllPrices(text);
  return prices.length > 0 ? prices[prices.length - 1] : null;
}

/** Find ALL R-prefixed prices in a string, returned in order of appearance */
function detectAllPrices(text: string): number[] {
  const results: number[] = [];
  // Global regex: R followed by optional space, digits/spaces/commas, then decimal
  const re = /R\s*([\d\s,]+[.,]\d{1,2})(?:\s|$|[^A-Za-z0-9]|,)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const val = parseRawPrice(m[1]);
    if (val !== null) results.push(val);
  }
  // Also try end-of-string match
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
  // SA format: comma as decimal (R4 399,00) — no dot present
  if (/,\d{1,2}$/.test(raw) && !/\.\d/.test(raw)) {
    raw = raw.replace(/\s/g, "").replace(/,(?=\d{1,2}$)/, ".");
  } else {
    // International format: dot decimal, comma/space thousands
    raw = raw.replace(/[,\s]/g, "");
  }
  const val = parseFloat(raw);
  if (!isNaN(val) && val >= 1) return val;
  return null;
}

/** Check if a text item contains an R-prefixed price */
function isPriceItem(text: string): boolean {
  return detectPrice(text) !== null;
}

/**
 * Merge adjacent text items where "R" or "R<digits>" is followed by a numeric
 * continuation on the same Y-line. This handles PDFs that split prices like
 * "R4" + "399,00" or "R" + "4 399,00" into separate text items.
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

    // Check if this item starts with R and could be a price fragment
    // e.g. "R", "R4", "R16" but NOT "R410A", "R32W"
    if (/^R\d*$/i.test(trimmed) && !isPriceItem(item.text)) {
      // Look for a numeric continuation on the same Y-line, to the right
      let bestJ = -1;
      let bestDist = Infinity;
      for (let j = 0; j < items.length; j++) {
        if (j === i || used.has(j)) continue;
        if (Math.abs(items[j].y - item.y) > yThreshold) continue;
        // Must be to the right and close
        const dist = items[j].x - (item.x + item.width);
        if (dist >= -2 && dist < bestDist) {
          // Must look like the numeric part of a price
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
 * HYBRID PRICE-FIRST: Match extracted text against products database.
 *
 * 1. Group ALL text items into rows by Y-proximity
 * 2. For each row, concatenate text and detect R-prefixed prices
 * 3. If row has a price, create a region
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

  // Pre-merge fragmented price items (e.g. "R" + "45,752")
  const mergedItems = mergeAdjacentPriceFragments(items, 3);

  const { byCode, byName, byDescription } = buildProductLookup(products);

  // ── STEP 1: Group ALL text items into rows by Y-proximity ──
  const sorted = [...mergedItems].sort((a, b) => a.y - b.y);

  // Compute adaptive Y threshold from consecutive Y gaps
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const g = sorted[i].y - sorted[i - 1].y;
    if (g > 0.5) gaps.push(g);
  }
  gaps.sort((a, b) => a - b);
  const medianGap = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : 6;
  // Use tighter threshold: no floor of 4, just 60% of median gap (min 1.5)
  const yThreshold = Math.max(1.5, medianGap * 0.6);

  console.log('[PDF_DEBUG] medianGap:', medianGap.toFixed(2), 'yThreshold:', yThreshold.toFixed(2), 'items:', sorted.length);

  const textRows: ExtractedTextItem[][] = [];
  let curRow: ExtractedTextItem[] = [sorted[0]];
  let curRowMaxY = sorted[0].y;

  for (let i = 1; i < sorted.length; i++) {
    // Compare against the MAX Y in current row, not just the first item
    if (sorted[i].y - curRowMaxY > yThreshold) {
      textRows.push(curRow);
      curRow = [];
      curRowMaxY = sorted[i].y;
    } else {
      curRowMaxY = Math.max(curRowMaxY, sorted[i].y);
    }
    curRow.push(sorted[i]);
  }
  if (curRow.length > 0) textRows.push(curRow);

  console.log('[PDF_DEBUG] Initial rows formed:', textRows.length);

  // ── STEP 1.5: Split merged rows that contain multiple distinct prices ──
  const splitRows: ExtractedTextItem[][] = [];
  const subThreshold = Math.max(1, yThreshold / 3);

  for (let ri = 0; ri < textRows.length; ri++) {
    const row = textRows[ri];
    const sortedRow = [...row].sort((a, b) => a.x - b.x);
    const rowText = sortedRow.map(it => it.text).join(" ");
    const prices = detectAllPrices(rowText);
    const uniquePrices = [...new Set(prices)];

    if (uniquePrices.length > 1) {
      // Multiple distinct prices — sub-group by tighter Y-proximity
      const byY = [...row].sort((a, b) => a.y - b.y);
      const subRows: ExtractedTextItem[][] = [[byY[0]]];
      let subY = byY[0].y;
      for (let k = 1; k < byY.length; k++) {
        if (byY[k].y - subY > subThreshold) {
          subRows.push([]);
          subY = byY[k].y;
        }
        subRows[subRows.length - 1].push(byY[k]);
      }
      if (subRows.length > 1) {
        console.log('[PDF_DEBUG] SPLIT row', ri, 'into', subRows.length, 'sub-rows. Prices:', uniquePrices, 'text:', rowText.substring(0, 100));
        for (const sr of subRows) splitRows.push(sr);
      } else {
        console.log('[PDF_DEBUG] Row', ri, 'has', uniquePrices.length, 'prices but could NOT split. Text:', rowText.substring(0, 100));
        splitRows.push(row);
      }
    } else {
      splitRows.push(row);
    }
  }

  console.log('[PDF_DEBUG] After split:', splitRows.length, 'rows');

  // ── STEP 2: Identify price rows, then expand with "fat row" for context ──
  const regions: ExtractedProductRegion[] = [];
  const seenCodes = new Set<string>();
  let priceRowCount = 0;
  const fatRowExpansion = yThreshold * 3; // Look 3x wider for model codes

  for (let index = 0; index < splitRows.length; index++) {
    const row = splitRows[index];
    const sortedRow = [...row].sort((a, b) => a.x - b.x);
    const rowText = sortedRow.map(it => it.text).join(" ");

    // Detect price on the FULL concatenated row text
    const detectedPrice = detectPrice(rowText);

    if (detectedPrice === null) continue;

    priceRowCount++;

    // Find rightmost item for icon anchor
    const anchor = sortedRow.reduce((best, item) =>
      (item.x + item.width > best.x + best.width) ? item : best, sortedRow[0]);
    const anchorY = anchor.y;
    const anchorHeight = anchor.height;

    // Ghost filter: skip prices in top 3% without model code
    const y_pct = (anchorY / pageHeight) * 100;
    if (y_pct < 3) {
      if (!/\b[A-Z]{2,}\d+[A-Z0-9]*\b/i.test(rowText)) continue;
    }

    if (rowText.trim().length < 3) continue;

    // ── "FAT ROW": expand Y range to capture model codes on nearby lines ──
    const rowMinY = Math.min(...row.map(it => it.y));
    const rowMaxY = Math.max(...row.map(it => it.y));
    const fatItems = items
      .filter(it => it.y >= rowMinY - fatRowExpansion && it.y <= rowMaxY + fatRowExpansion)
      .sort((a, b) => a.x - b.x);
    const fatRowText = fatItems.map(it => it.text).join(" ");
    const fatRowTextLower = fatRowText.toLowerCase();

    // Use fat row text for matching, but narrow row text for label
    const matchText = fatRowTextLower;

    // ── Try matching against product DB ──
    let matched: PaletteProduct | null = null;
    let matchedCode = "";

    for (const [code, product] of byCode) {
      if (code.length >= 3 && matchText.includes(code)) {
        matched = product;
        matchedCode = product.product_code;
        break;
      }
    }

    if (!matched) {
      for (const [name, product] of byName) {
        if (name.length >= 5 && matchText.includes(name)) {
          matched = product;
          matchedCode = product.product_code;
          break;
        }
      }
    }

    if (!matched) {
      for (const [desc, product] of byDescription) {
        if (desc.length >= 8 && matchText.includes(desc)) {
          matched = product;
          matchedCode = product.product_code;
          break;
        }
      }
    }

    // Extract a code for dedup (from fat row text for better coverage)
    const extractedCode = matchedCode || (() => {
      const codeMatch = fatRowText.match(/\b([A-Z]{2,}\d+[A-Z0-9-]*)\b/);
      if (codeMatch) return codeMatch[1];
      const priceTag = detectedPrice ? `@${detectedPrice}` : "";
      return rowText.trim().substring(0, 80) + priceTag;
    })();

    // Code dedup
    const codeKey = extractedCode.toLowerCase().trim();
    if (codeKey.length >= 3 && codeKey.length < 40 && seenCodes.has(codeKey)) continue;
    if (codeKey.length >= 3 && codeKey.length < 40) seenCodes.add(codeKey);

    // Position
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

  // ── STEP 5: Y-bucket dedup — never merge rows with different prices ──
  const deduped: ExtractedProductRegion[] = [];
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    const isDuplicate = deduped.some(d =>
      Math.abs(d.y_pct - r.y_pct) < 0.3 &&
      d.detected_price === r.detected_price
    );
    if (isDuplicate) {
      // If duplicate position AND same price, keep the matched one
      const idx = deduped.findIndex(d =>
        Math.abs(d.y_pct - r.y_pct) < 0.3 && d.detected_price === r.detected_price
      );
      if (idx >= 0 && r.matched && !deduped[idx].matched) {
        deduped[idx] = r;
      }
    } else {
      deduped.push(r);
    }
  }

  // ── STEP 6: Align all icons to a single x column ──
  if (deduped.length > 0) {
    const maxX = Math.max(...deduped.map(r => r.x_pct));
    for (const r of deduped) {
      r.x_pct = maxX;
    }
  }


  return deduped;
}

// Cache for extracted regions per page
let _extractionVersion = 22; // v22: adaptive threshold, merge fragments, debug logs
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
