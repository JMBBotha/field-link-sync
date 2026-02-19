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
/**
 * PRICE-FIRST scan: find individual price text items, group by Y, build rows.
 * This approach is immune to row-merge issues because it finds prices first.
 */
function priceFirstScan(
  items: ExtractedTextItem[],
  pageWidth: number,
  pageHeight: number,
  products: PaletteProduct[],
  lookup: ReturnType<typeof buildProductLookup>
): ExtractedProductRegion[] {
  const { byCode, byName, byDescription } = lookup;
  const mergedItems = mergeAdjacentPriceFragments(items, 3);

  // Find ALL text items that contain an R-prefixed price >= 1000
  const priceItems: { item: ExtractedTextItem; price: number; y_pct: number }[] = [];
  for (const item of mergedItems) {
    const p = detectPrice(item.text);
    if (p !== null && p >= 50) {
      priceItems.push({ item, price: p, y_pct: (item.y / pageHeight) * 100 });
    }
  }

  if (priceItems.length === 0) return [];

  // Group price items by Y-coordinate with tight 0.15% tolerance
  priceItems.sort((a, b) => a.y_pct - b.y_pct);
  const priceRows: typeof priceItems[] = [[priceItems[0]]];
  for (let i = 1; i < priceItems.length; i++) {
    const lastGroup = priceRows[priceRows.length - 1];
    const lastY = lastGroup[lastGroup.length - 1].y_pct;
    if (priceItems[i].y_pct - lastY < 0.15) {
      lastGroup.push(priceItems[i]);
    } else {
      priceRows.push([priceItems[i]]);
    }
  }

  // For each price Y-group, build a product region
  const regions: ExtractedProductRegion[] = [];
  const seenPriceY = new Set<string>();

  for (const group of priceRows) {
    // Use the rightmost price as the detected price
    const rightmost = group.reduce((best, cur) =>
      cur.item.x > best.item.x ? cur : best, group[0]);
    const detectedPrice = rightmost.price;
    const anchorY = rightmost.y_pct;
    const anchorHeight = rightmost.item.height;

    // Dedup key: price + Y bucket
    const dedupKey = `${detectedPrice}@${Math.round(anchorY * 10)}`;
    if (seenPriceY.has(dedupKey)) continue;
    seenPriceY.add(dedupKey);

    // Ghost filter: skip prices in top 3% without model code
    if (anchorY < 3) continue;

    // Gather context: all text items within ±0.5% Y range
    const yMin = rightmost.item.y - pageHeight * 0.005;
    const yMax = rightmost.item.y + pageHeight * 0.005;
    const contextItems = mergedItems
      .filter(it => it.y >= yMin && it.y <= yMax)
      .sort((a, b) => a.x - b.x);
    const rowText = contextItems.map(it => it.text).join(" ");

    if (rowText.trim().length < 3) continue;

    // Expand for model code matching (fat row)
    const fatYMin = rightmost.item.y - pageHeight * 0.02;
    const fatYMax = rightmost.item.y + pageHeight * 0.02;
    const fatItems = items
      .filter(it => it.y >= fatYMin && it.y <= fatYMax)
      .sort((a, b) => a.x - b.x);
    const matchText = fatItems.map(it => it.text).join(" ").toLowerCase();

    // Match against product DB
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

    const extractedCode = matchedCode || (() => {
      const fatText = fatItems.map(it => it.text).join(" ");
      const codeMatch = fatText.match(/\b([A-Z]{2,}\d+[A-Z0-9-]*)\b/);
      if (codeMatch) return codeMatch[1];
      return rowText.trim().substring(0, 80) + `@${detectedPrice}`;
    })();

    const h_pct = Math.max((anchorHeight / pageHeight) * 100, 1.5);
    if (anchorY > 100 || h_pct > 5) continue;

    regions.push({
      product: matched,
      product_code: extractedCode,
      label: rowText.trim().substring(0, 200),
      x_pct: 95,
      y_pct: Math.max(0, anchorY),
      w_pct: 4,
      h_pct: Math.min(100 - anchorY, h_pct),
      matched: !!matched,
      has_price: true,
      detected_price: detectedPrice,
    });
  }

  return regions;
}

/**
 * LEGACY row-grouping approach (fallback).
 */
function rowGroupingScan(
  items: ExtractedTextItem[],
  pageWidth: number,
  pageHeight: number,
  products: PaletteProduct[],
  lookup: ReturnType<typeof buildProductLookup>
): ExtractedProductRegion[] {
  const { byCode, byName, byDescription } = lookup;
  const mergedItems = mergeAdjacentPriceFragments(items, 3);
  const sorted = [...mergedItems].sort((a, b) => a.y - b.y);

  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const g = sorted[i].y - sorted[i - 1].y;
    if (g > 0.5) gaps.push(g);
  }
  gaps.sort((a, b) => a - b);
  const medianGap = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : 6;
  const yThreshold = Math.max(1.5, medianGap * 0.6);

  const textRows: ExtractedTextItem[][] = [];
  let curRow: ExtractedTextItem[] = [sorted[0]];
  let curRowMaxY = sorted[0].y;

  for (let i = 1; i < sorted.length; i++) {
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

  const regions: ExtractedProductRegion[] = [];
  const seenCodes = new Set<string>();
  const fatRowExpansion = yThreshold * 3;

  for (const row of textRows) {
    const sortedRow = [...row].sort((a, b) => a.x - b.x);
    const rowText = sortedRow.map(it => it.text).join(" ");
    const detectedPrice = detectPrice(rowText);
    if (detectedPrice === null) continue;

    const anchor = sortedRow.reduce((best, item) =>
      (item.x + item.width > best.x + best.width) ? item : best, sortedRow[0]);
    const anchorY = anchor.y;
    const anchorHeight = anchor.height;
    const y_pct = (anchorY / pageHeight) * 100;

    if (y_pct < 3 && !/\b[A-Z]{2,}\d+[A-Z0-9]*\b/i.test(rowText)) continue;
    if (rowText.trim().length < 3) continue;

    const rowMinY = Math.min(...row.map(it => it.y));
    const rowMaxY = Math.max(...row.map(it => it.y));
    const fatItems = items
      .filter(it => it.y >= rowMinY - fatRowExpansion && it.y <= rowMaxY + fatRowExpansion)
      .sort((a, b) => a.x - b.x);
    const fatRowText = fatItems.map(it => it.text).join(" ");
    const matchText = fatRowText.toLowerCase();

    let matched: PaletteProduct | null = null;
    let matchedCode = "";

    for (const [code, product] of byCode) {
      if (code.length >= 3 && matchText.includes(code)) {
        matched = product; matchedCode = product.product_code; break;
      }
    }
    if (!matched) {
      for (const [name, product] of byName) {
        if (name.length >= 5 && matchText.includes(name)) {
          matched = product; matchedCode = product.product_code; break;
        }
      }
    }
    if (!matched) {
      for (const [desc, product] of byDescription) {
        if (desc.length >= 8 && matchText.includes(desc)) {
          matched = product; matchedCode = product.product_code; break;
        }
      }
    }

    const extractedCode = matchedCode || (() => {
      const codeMatch = fatRowText.match(/\b([A-Z]{2,}\d+[A-Z0-9-]*)\b/);
      if (codeMatch) return codeMatch[1];
      return rowText.trim().substring(0, 80) + `@${detectedPrice}`;
    })();

    const codeKey = extractedCode.toLowerCase().trim();
    if (codeKey.length >= 3 && codeKey.length < 40 && seenCodes.has(codeKey)) continue;
    if (codeKey.length >= 3 && codeKey.length < 40) seenCodes.add(codeKey);

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

  return regions;
}

/**
 * HYBRID: Run price-first scan AND legacy row-grouping, merge results.
 */
export function matchTextRowsToProducts(
  items: ExtractedTextItem[],
  pageWidth: number,
  pageHeight: number,
  products: PaletteProduct[]
): ExtractedProductRegion[] {
  if (items.length === 0 || pageHeight === 0) return [];

  const lookup = buildProductLookup(products);

  const priceFirstResults = priceFirstScan(items, pageWidth, pageHeight, products, lookup);
  const rowGroupResults = rowGroupingScan(items, pageWidth, pageHeight, products, lookup);

  // Merge: start with price-first results, add row-group results that don't overlap
  const merged = [...priceFirstResults];
  for (const r of rowGroupResults) {
    const isDuplicate = merged.some(m =>
      Math.abs(m.y_pct - r.y_pct) < 0.3 && m.detected_price === r.detected_price
    );
    if (!isDuplicate) {
      // Also check if same price exists at any Y (avoid duplicate prices from different methods)
      const samePriceNearby = merged.some(m =>
        m.detected_price === r.detected_price && Math.abs(m.y_pct - r.y_pct) < 2
      );
      if (!samePriceNearby) {
        merged.push(r);
      }
    }
  }

  // Prefer matched over unmatched at same position
  const deduped: ExtractedProductRegion[] = [];
  for (const r of merged) {
    const idx = deduped.findIndex(d =>
      Math.abs(d.y_pct - r.y_pct) < 0.3 && d.detected_price === r.detected_price
    );
    if (idx >= 0) {
      if (r.matched && !deduped[idx].matched) deduped[idx] = r;
    } else {
      deduped.push(r);
    }
  }

  // Align icons to single x column
  if (deduped.length > 0) {
    const maxX = Math.max(...deduped.map(r => r.x_pct));
    for (const r of deduped) r.x_pct = maxX;
  }

  return deduped;
}

// Cache for extracted regions per page
let _extractionVersion = 23; // v23: price-first scan + legacy fallback merge
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
