/**
 * PDF Text Extraction & Product Matching Utility
 *
 * Uses pdfjs-dist to extract text items with their exact coordinates
 * from a PDF page, then cross-references against the products database.
 *
 * v24: Unified price-first approach with avgHeight-based adaptive threshold.
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
  if (!isNaN(val) && val >= 1) return val;
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
 * Check if a standalone numeric candidate is immediately preceded by a lone "R"
 * on the same row (virtual merge without modifying text items).
 */
function isPrecededByR(
  candidate: ExtractedTextItem,
  allItems: ExtractedTextItem[],
  yThreshold: number
): boolean {
  // Find items on same row, to the left of candidate
  const leftNeighbors = allItems.filter(
    (it) =>
      it !== candidate &&
      Math.abs(it.y - candidate.y) <= yThreshold &&
      it.x + it.width <= candidate.x + 2 // to the left (small tolerance)
  );
  if (leftNeighbors.length === 0) return false;
  // Sort by x descending to get closest left neighbor
  leftNeighbors.sort((a, b) => b.x - a.x);
  const closest = leftNeighbors[0];
  const gap = candidate.x - (closest.x + closest.width);
  if (gap > closest.width * 4) return false; // too far
  const isR = closest.text.trim() === "R";
  if (isR) {
    console.log(`[pdfExtract] isPrecededByR: ✓ candidate "${candidate.text.trim()}" at y=${candidate.y.toFixed(1)} preceded by "R" at x=${closest.x.toFixed(1)}, gap=${gap.toFixed(1)}px`);
  }
  return isR;
}

/**
 * PRICE-FIRST approach v28: enhanced with virtual R-merge for dense tables.
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

  // Adaptive Y-threshold from unique Y positions
  const uniqueYs = [...new Set(mergedItems.map((i) => Math.round(i.y * 10) / 10))].sort((a, b) => a - b);
  const yDiffs: number[] = [];
  for (let i = 1; i < uniqueYs.length; i++) {
    yDiffs.push(uniqueYs[i] - uniqueYs[i - 1]);
  }
  const smallDiffs = yDiffs.filter((d) => d > 0 && d < 5);
  const avgHeight =
    mergedItems.reduce((sum, i) => sum + i.height, 0) / mergedItems.length || 10;
  const yThreshold = smallDiffs.length > 0
    ? Math.max(Math.max(...smallDiffs) * 1.5, avgHeight * 1.2)
    : Math.max(avgHeight * 1.2, 5);

  // STEP 1a: Find items with explicit R-prefixed prices
  const explicitPriceItems = mergedItems.filter(
    (item) => /R\s*\d/.test(item.text) && detectPrice(item.text) !== null
  );

  // STEP 1b: Find standalone numeric candidates preceded by lone "R"
  const standaloneNumeric = mergedItems.filter((item) => {
    const t = item.text.trim();
    if (!/^\d[\d\s,.]+$/.test(t)) return false;
    // Must look like a price (has decimal separator or >= 4 digits)
    if (!/[,.]/.test(t) && t.replace(/\s/g, "").length < 4) return false;
    return isPrecededByR(item, mergedItems, yThreshold);
  });

  // Combine and deduplicate by position
  const seen = new Set<string>();
  const priceItems: ExtractedTextItem[] = [];
  for (const item of [...explicitPriceItems, ...standaloneNumeric]) {
    const key = `${item.x.toFixed(1)},${item.y.toFixed(1)}`;
    if (!seen.has(key)) {
      seen.add(key);
      priceItems.push(item);
    }
  }

  console.log(`[pdfExtract] matchTextRows: ${mergedItems.length} items after merge, yThreshold=${yThreshold.toFixed(1)}, explicit R-prices=${explicitPriceItems.length}, standalone numeric preceded by R=${standaloneNumeric.length}, combined unique=${priceItems.length}`);

  if (priceItems.length === 0) return [];

  // STEP 2: Group price items into rows by Y-coordinate
  const sortedPrices = [...priceItems].sort((a, b) => a.y - b.y);
  const priceRows: { items: ExtractedTextItem[] }[] = [];
  let curGroup: ExtractedTextItem[] = [sortedPrices[0]];

  for (let i = 1; i < sortedPrices.length; i++) {
    if (Math.abs(sortedPrices[i].y - curGroup[curGroup.length - 1].y) <= yThreshold) {
      curGroup.push(sortedPrices[i]);
    } else {
      priceRows.push({ items: curGroup.sort((a, b) => a.x - b.x) });
      curGroup = [sortedPrices[i]];
    }
  }
  priceRows.push({ items: curGroup.sort((a, b) => a.x - b.x) });

  // Model code regex - broad enough for Samsung, Daikin, Midea
  const modelRegex = /^[A-Za-z0-9\-\/]{5,}$/;

  // STEP 3: For each price row, gather context and build a region
  const regions: ExtractedProductRegion[] = [];

  for (const pRow of priceRows) {
    const rightmost = pRow.items[pRow.items.length - 1];
    // Try explicit R-prefixed price first, then raw numeric parse for virtual-merged items
    let detectedPrice = detectPrice(rightmost.text);
    if (detectedPrice === null) {
      const raw = rightmost.text.trim().replace(/\s/g, "").replace(/,(?=\d{1,2}$)/, ".");
      const val = parseFloat(raw);
      if (!isNaN(val) && val >= 50) detectedPrice = val;
    }
    if (detectedPrice === null || detectedPrice < 50) continue;

    const rowAvgY = pRow.items.reduce((s, i) => s + i.y, 0) / pRow.items.length;

    // Ghost filter: skip if in top 3% AND no model code nearby
    const y_pct = (rowAvgY / pageHeight) * 100;

    // Gather ALL text items on the same Y-band for context
    const contextItems = mergedItems.filter(
      (it) => Math.abs(it.y - rowAvgY) <= yThreshold
    );

    // Also gather items slightly above (for multi-line descriptions)
    const aboveItems = mergedItems.filter(
      (it) => it.y < rowAvgY - yThreshold && it.y >= rowAvgY - yThreshold * 3 &&
        !(/R\s*\d/.test(it.text) && detectPrice(it.text) !== null)
    );

    const allContext = [...aboveItems, ...contextItems];
    const hasModel = allContext.some((i) => modelRegex.test(i.text.trim()));

    if (y_pct < 3 && !hasModel) continue;

    // Build match text from all context
    const matchText = allContext.map((it) => it.text).join(" ").toLowerCase();
    const rowText = contextItems.map((it) => it.text).join(" ");

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

    const extractedCode =
      matchedCode ||
      (() => {
        const codeMatch = allContext.map((it) => it.text).join(" ").match(/\b([A-Za-z]{2,}\d+[A-Za-z0-9\-]*)\b/);
        return codeMatch
          ? codeMatch[1]
          : rowText.trim().substring(0, 80) + `@${detectedPrice}`;
      })();

    const anchorHeight = rightmost.height;
    const h_pct = Math.max((anchorHeight / pageHeight) * 100, 1.5);
    if (y_pct > 100 || h_pct > 5) continue;

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

  // Align all icons to a single X column
  if (regions.length > 0) {
    const maxX = Math.max(...regions.map((r) => r.x_pct));
    for (const r of regions) r.x_pct = maxX;
  }

  return regions;
}

// Cache for extracted regions per page
let _extractionVersion = 28; // v28: virtual R-merge for dense table PDFs
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
      loneRItems.forEach(r => console.log(`[pdfExtract]   R at x=${r.x.toFixed(1)} y=${r.y.toFixed(1)}`));
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
