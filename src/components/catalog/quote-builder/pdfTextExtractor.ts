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
 * PRICE-FIRST approach: find prices first, group into rows, then build regions.
 * Uses avgHeight-based adaptive threshold for row grouping.
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

  // Dynamic threshold based on average text item height
  const avgHeight =
    mergedItems.reduce((sum, i) => sum + i.height, 0) / mergedItems.length || 10;
  const yThreshold = avgHeight * 1.2;

  // Filter price items (>= 50 ZAR)
  const priceItems = mergedItems.filter(
    (item) => {
      const p = detectPrice(item.text);
      return p !== null && p >= 50;
    }
  );
  if (priceItems.length === 0) return [];

  // Group ALL text items into rows sorted by Y
  const sortedItems = [...mergedItems].sort((a, b) => a.y - b.y);
  const allRows: { avgY: number; items: ExtractedTextItem[] }[] = [];
  let currentItems: ExtractedTextItem[] = [sortedItems[0]];
  let currentY = sortedItems[0].y;

  for (let i = 1; i < sortedItems.length; i++) {
    if (Math.abs(sortedItems[i].y - currentY) <= yThreshold) {
      currentItems.push(sortedItems[i]);
    } else {
      const avgY =
        currentItems.reduce((sum, it) => sum + it.y, 0) / currentItems.length;
      allRows.push({
        avgY,
        items: currentItems.sort((a, b) => a.x - b.x),
      });
      currentItems = [sortedItems[i]];
      currentY = sortedItems[i].y;
    }
  }
  if (currentItems.length > 0) {
    const avgY =
      currentItems.reduce((sum, it) => sum + it.y, 0) / currentItems.length;
    allRows.push({
      avgY,
      items: currentItems.sort((a, b) => a.x - b.x),
    });
  }

  // Group price items into price rows
  const sortedPrices = [...priceItems].sort((a, b) => a.y - b.y);
  const priceRows: { avgY: number; prices: ExtractedTextItem[] }[] = [];
  let curPrices: ExtractedTextItem[] = [sortedPrices[0]];
  currentY = sortedPrices[0].y;

  for (let i = 1; i < sortedPrices.length; i++) {
    if (Math.abs(sortedPrices[i].y - currentY) <= yThreshold) {
      curPrices.push(sortedPrices[i]);
    } else {
      const avgY =
        curPrices.reduce((sum, it) => sum + it.y, 0) / curPrices.length;
      priceRows.push({
        avgY,
        prices: curPrices.sort((a, b) => a.x - b.x),
      });
      curPrices = [sortedPrices[i]];
      currentY = sortedPrices[i].y;
    }
  }
  if (curPrices.length > 0) {
    const avgY =
      curPrices.reduce((sum, it) => sum + it.y, 0) / curPrices.length;
    priceRows.push({
      avgY,
      prices: curPrices.sort((a, b) => a.x - b.x),
    });
  }

  // Model code regex
  const modelRegex = /^[A-Z0-9\-\/]{6,}$/;

  // Process each price row into a product region
  const regions: ExtractedProductRegion[] = [];

  for (const pRow of priceRows) {
    // Find the corresponding row in allRows
    const priceIndex = allRows.findIndex(
      (r) => Math.abs(r.avgY - pRow.avgY) < yThreshold / 2
    );
    if (priceIndex === -1) continue;

    // Collect items starting with the price row
    let collected: ExtractedTextItem[] = [...allRows[priceIndex].items];

    // Merge upwards (non-price rows that are close)
    for (let j = priceIndex - 1; j >= 0; j--) {
      const gap = allRows[j + 1].avgY - allRows[j].avgY;
      if (gap > yThreshold * 2) break;
      if (allRows[j].items.some((item) => isPriceItem(item.text))) break;
      collected = [...allRows[j].items, ...collected];
    }

    // Merge downwards (non-price rows that are close)
    for (let j = priceIndex + 1; j < allRows.length; j++) {
      const gap = allRows[j].avgY - allRows[j - 1].avgY;
      if (gap > yThreshold * 2) break;
      if (allRows[j].items.some((item) => isPriceItem(item.text))) break;
      collected.push(...allRows[j].items);
    }

    // Ghost filter: skip if in top 3% and no model code
    const y_pct = (pRow.avgY / pageHeight) * 100;
    const hasModel = collected.some((i) => modelRegex.test(i.text.trim()));
    if (y_pct < 3 && !hasModel) continue;

    // Get rightmost price as the detected price
    const rightmost = pRow.prices[pRow.prices.length - 1];
    const detectedPrice = detectPrice(rightmost.text);

    // Build match text from all collected items
    const matchText = collected.map((it) => it.text).join(" ").toLowerCase();
    const rowText = allRows[priceIndex].items
      .map((it) => it.text)
      .join(" ");

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
        const fullText = collected.map((it) => it.text).join(" ");
        const codeMatch = fullText.match(/\b([A-Z]{2,}\d+[A-Z0-9-]*)\b/);
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

  // Align icons to single x column
  if (regions.length > 0) {
    const maxX = Math.max(...regions.map((r) => r.x_pct));
    for (const r of regions) r.x_pct = maxX;
  }

  return regions;
}

// Cache for extracted regions per page
let _extractionVersion = 24; // v24: unified price-first with avgHeight threshold
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
