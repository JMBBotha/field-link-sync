/**
 * PDF Text Extraction & Product Matching Utility
 *
 * Uses pdfjs-dist to extract text items with their exact coordinates
 * from a PDF page, then cross-references against the products database.
 *
 * v40: RIGHTMOST-ONLY – all price detection (R-prefixed AND standalone numeric)
 *      is gated by column position. Eliminates ghost regions from EXCL/VAT columns.
 */
import type { PaletteProduct } from "../QuoteBuilderTab";

/**
 * Sanitize PDF URL by trimming trailing spaces from path segments.
 */
function sanitizePdfUrl(url: string): string {
  try {
    const u = new URL(url);
    u.pathname = u.pathname
      .split("/")
      .map((seg) => decodeURIComponent(seg).trim())
      .map((seg) => encodeURIComponent(seg))
      .join("/");
    return u.toString();
  } catch {
    return url.replace(/%20\//g, "/").replace(/ \//g, "/");
  }
}

/** Lazily load pdfjs-dist */
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
  pageNumber: number,
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

// ─── Price Column Detection ─────────────────────────────────────────────────

/**
 * Find the RIGHTMOST price column x-range.
 *
 * Strategy:
 * 1. Look for column headers ("PRICE", "INCL", "EXCL", "VAT") across the entire page.
 *    Pick the RIGHTMOST header as the price column.
 * 2. Fallback: cluster R-prefixed prices by x-position; pick rightmost cluster.
 * 3. Last resort: x > 80% of page width.
 */
function findPriceColumnRange(
  items: ExtractedTextItem[],
  pageWidth: number,
  pageHeight: number,
): { minX: number; maxX: number } | null {
  // --- Strategy 1: Header-based ---
  const priceHeaders = items.filter((i) => {
    const t = i.text.trim().toUpperCase();
    return (
      t.includes("PRICE") ||
      t === "EXCL" ||
      t.includes("EXCL VAT") ||
      t.includes("INCL VAT") ||
      t.includes("INCL.VAT") ||
      t.includes("NETT PRICE") ||
      t.includes("INSTALLER PRICE") ||
      t.includes("WEBSHOP PRICE") ||
      t.includes("CAMPAIGN PRICE") ||
      t.includes("LIST PRICE") ||
      t === "VAT"
    );
  });

  if (priceHeaders.length > 0) {
    // Use the RIGHTMOST header
    priceHeaders.sort((a, b) => b.x - a.x);
    const header = priceHeaders[0];
    const colMinX = header.x - 20;
    const colMaxX = header.x + header.width + 40;
    console.log(
      `[pdfExtract] Price column from header "${header.text.trim()}" at x=${header.x.toFixed(0)}: range ${colMinX.toFixed(0)}-${colMaxX.toFixed(0)} (pageWidth=${pageWidth.toFixed(0)})`,
    );
    return { minX: colMinX, maxX: colMaxX };
  }

  // --- Strategy 2: Cluster R-prefixed prices by x-position ---
  const rPriceItems = items.filter((i) => /R\s*\d/.test(i.text) && detectPrice(i.text) !== null);
  if (rPriceItems.length >= 3) {
    // Group by x-position (bucket by 30px)
    const buckets = new Map<number, ExtractedTextItem[]>();
    for (const item of rPriceItems) {
      const bucket = Math.round(item.x / 30) * 30;
      if (!buckets.has(bucket)) buckets.set(bucket, []);
      buckets.get(bucket)!.push(item);
    }
    // Pick rightmost bucket with at least 2 items
    const sorted = [...buckets.entries()].sort((a, b) => b[0] - a[0]);
    for (const [bucketX, bucketItems] of sorted) {
      if (bucketItems.length >= 2) {
        const minX = Math.min(...bucketItems.map((i) => i.x)) - 10;
        const maxX = Math.max(...bucketItems.map((i) => i.x + i.width)) + 10;
        console.log(
          `[pdfExtract] Price column from R-price cluster at bucket x=${bucketX}: range ${minX.toFixed(0)}-${maxX.toFixed(0)}`,
        );
        return { minX, maxX };
      }
    }
  }

  // --- Strategy 3: Right-side numeric fallback ---
  const rightNumerics = items.filter((i) => i.x / pageWidth > 0.75 && /^\d[\d\s,.]+$/.test(i.text.trim()));
  if (rightNumerics.length > 3) {
    const minX = Math.min(...rightNumerics.map((i) => i.x)) - 10;
    const maxX = Math.max(...rightNumerics.map((i) => i.x + i.width)) + 10;
    console.log(`[pdfExtract] Price column from right-side numerics: range ${minX.toFixed(0)}-${maxX.toFixed(0)}`);
    return { minX, maxX };
  }

  console.log(`[pdfExtract] No price column detected, will use x > 80% fallback`);
  return null;
}

/**
 * Check if a text item's CENTER-X falls within the rightmost price column.
 */
function isInPriceColumn(
  item: ExtractedTextItem,
  colRange: { minX: number; maxX: number } | null,
  pageWidth: number,
): boolean {
  const centerX = item.x + item.width / 2;
  if (colRange) {
    return centerX >= colRange.minX && centerX <= colRange.maxX;
  }
  // No column detected → only accept items in the rightmost 20%
  return centerX / pageWidth > 0.8;
}

// ─── Currency Merging ───────────────────────────────────────────────────────

/**
 * Merge lone "R" currency symbols with adjacent price digits on the same row.
 * ONLY merges if "R" is in the rightmost price column.
 */
export function mergeCurrencyWithPrices(
  items: ExtractedTextItem[],
  colRange: { minX: number; maxX: number } | null,
  pageWidth: number,
): ExtractedTextItem[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const result: ExtractedTextItem[] = [];
  const skip = new Set<number>();

  const avgHeight = sorted.length > 0 ? sorted.reduce((sum, i) => sum + i.height, 0) / sorted.length : 10;
  const yThreshold = Math.max(avgHeight * 1.2, 8);

  for (let i = 0; i < sorted.length; i++) {
    if (skip.has(i)) continue;
    const item = sorted[i];
    const trimmed = item.text.trim();

    if (trimmed === "R" || trimmed === "R ") {
      // STRICT: Only merge if "R" is in rightmost price column
      if (!isInPriceColumn(item, colRange, pageWidth)) {
        result.push(item);
        continue;
      }

      let bestJ = -1;
      for (let j = i + 1; j < sorted.length; j++) {
        if (Math.abs(sorted[j].y - item.y) > yThreshold) continue;
        if (sorted[j].x < item.x + item.width - 2) continue;
        const gap = sorted[j].x - (item.x + item.width);
        if (gap > item.width * 4) continue;
        const nextText = sorted[j].text.trim();
        if (!/^\d[\d\s,.]*$/.test(nextText)) continue;
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
          width: next.x + next.width - item.x,
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

// ─── Price Detection ────────────────────────────────────────────────────────

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

  // R-prefixed with decimals
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

  // Whole number R-prefixed (R + number >= 100 to avoid R32/R410 gas types)
  const re3 = /R\s*(\d[\d\s]*)(?![A-Za-z])/g;
  while ((m = re3.exec(text)) !== null) {
    const raw = m[1].replace(/\s/g, "");
    const val = parseFloat(raw);
    if (!isNaN(val) && val >= 1 && !results.includes(val)) results.push(val);
  }

  // Standalone (no R): Require >= 4 digits
  const re4 = /^(\d[\d\s,]*[.,]?\d*)$/g;
  while ((m = re4.exec(text)) !== null) {
    const digits = m[1].replace(/[\s,.]/g, "");
    if (digits.length >= 4) {
      const val = parseFloat(m[1].replace(/,/g, "").replace(/\s/g, ""));
      if (!isNaN(val) && val >= 1 && !results.includes(val)) results.push(val);
    }
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

// ─── Product Lookup ─────────────────────────────────────────────────────────

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

// ─── Ghost / Header Filtering ───────────────────────────────────────────────

function isHeaderOrNonProductRow(rowText: string, _detectedPrice: number, hasModel: boolean, y_pct: number): boolean {
  const lower = rowText.toLowerCase();

  // TOC detection
  if (/\.{4,}/.test(rowText) || /^\w+\s+\.{4,}\s*\d+$/.test(rowText)) {
    return true;
  }

  // Page headers in top 3% without model code
  if (y_pct < 3 && !hasModel) {
    return true;
  }

  // Non-product keywords
  const headerKeywords = [
    "contents",
    "table of contents",
    "index",
    "page",
    "chapter",
    "introduction",
    "notes",
    "disclaimer",
    "warranty",
    "terms",
    "technical specifications",
    "installation",
    "maintenance",
  ];
  if (headerKeywords.some((kw) => lower.includes(kw))) {
    return true;
  }

  return false;
}

// ─── Main Matching ──────────────────────────────────────────────────────────

/**
 * PRICE-FIRST approach v40: RIGHTMOST-COLUMN-ONLY detection.
 *
 * Key change from v39: Both R-prefixed AND standalone numeric prices are
 * filtered through `isInPriceColumn()` so only the rightmost column is used.
 * This eliminates ghost regions from EXCL VAT, VAT, and other left/middle columns.
 */
export function matchTextRowsToProducts(
  items: ExtractedTextItem[],
  pageWidth: number,
  pageHeight: number,
  products: PaletteProduct[],
): ExtractedProductRegion[] {
  if (items.length === 0 || pageHeight === 0) return [];

  const { byCode, byName, byDescription } = buildProductLookup(products);
  const colRange = findPriceColumnRange(items, pageWidth, pageHeight);

  // Merge R+digits only in rightmost column
  const mergedItems = mergeCurrencyWithPrices(items, colRange, pageWidth);

  const avgHeight = mergedItems.reduce((sum, i) => sum + i.height, 0) / mergedItems.length || 10;

  // ── STEP 1: Collect ALL price items, but ONLY from the rightmost column ──

  const priceItems: ExtractedTextItem[] = [];
  const seen = new Set<string>();

  for (const item of mergedItems) {
    // Gate: item must be in the rightmost price column
    if (!isInPriceColumn(item, colRange, pageWidth)) continue;

    // Try R-prefixed price
    let price: number | null = null;
    if (/R\s*\d/.test(item.text)) {
      price = detectPrice(item.text);
    }

    // Try standalone numeric (no R prefix)
    if (price === null) {
      const t = item.text.trim();
      if (/^\d[\d\s,.]*$/.test(t)) {
        const digits = t.replace(/[\s,.]/g, "");
        if (digits.length >= 4) {
          let raw = t.replace(/\s/g, "");
          if (/,\d{1,2}$/.test(raw) && !/\.\d/.test(raw)) {
            raw = raw.replace(/,(?=\d{1,2}$)/, ".");
          } else {
            raw = raw.replace(/,/g, "");
          }
          const val = parseFloat(raw);
          if (!isNaN(val) && val >= 1) price = val;
        }
      }
    }

    if (price === null || price <= 0) continue;

    const key = `${item.x.toFixed(0)},${item.y.toFixed(0)}`;
    if (!seen.has(key)) {
      seen.add(key);
      priceItems.push(item);
    }
  }

  console.log(
    `[pdfExtract] matchTextRows v40: ${mergedItems.length} items, ` +
      `rightmost-column prices=${priceItems.length}, ` +
      `colRange=${colRange ? `${colRange.minX.toFixed(0)}-${colRange.maxX.toFixed(0)}` : "none (x>80%)"}, ` +
      `pageWidth=${pageWidth.toFixed(0)}`,
  );

  if (priceItems.length === 0) return [];

  // ── STEP 2: One row per price item ──

  const sortedPrices = [...priceItems].sort((a, b) => a.y - b.y);
  const modelRegex = /^[A-Za-z0-9\-\/]{5,}$/;

  // ── STEP 3: Build regions ──

  const regions: ExtractedProductRegion[] = [];
  const skippedCount = { noPrice: 0, ghost: 0, outOfBounds: 0 };
  const assignedCodes = new Set<string>();
  const tightBand = avgHeight * 0.6;

  for (const priceItem of sortedPrices) {
    // Parse price from this item
    let detectedPrice = detectPrice(priceItem.text);
    if (detectedPrice === null) {
      let raw = priceItem.text.trim().replace(/\s/g, "");
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

    const y_pct = (priceItem.y / pageHeight) * 100;

    // Gather context from the SAME ROW (tight band)
    const contextItems = mergedItems.filter((it) => Math.abs(it.y - priceItem.y) <= tightBand);
    const hasModel = contextItems.some((i) => modelRegex.test(i.text.trim()));
    const rowText = contextItems.map((it) => it.text).join(" ");

    if (isHeaderOrNonProductRow(rowText, detectedPrice, hasModel, y_pct)) {
      skippedCount.ghost++;
      continue;
    }

    // ── Product matching (position-aware) ──
    const matchTextLower = rowText.toLowerCase();
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
        const codeMatch = contextItems
          .map((it) => it.text)
          .join(" ")
          .match(/\b([A-Za-z]{2,}\d+[A-Za-z0-9\-]*)\b/);
        return codeMatch ? codeMatch[1] : rowText.trim().substring(0, 80) + `@${detectedPrice}`;
      })();

    const anchorHeight = priceItem.height;
    const h_pct = Math.max((anchorHeight / pageHeight) * 100, 1.5);
    if (y_pct > 100 || h_pct > 5) {
      skippedCount.outOfBounds++;
      continue;
    }

    // Position the region at the PRICE ITEM's location (rightmost column only)
    const x_pct = (priceItem.x / pageWidth) * 100;
    const w_pct = Math.max((priceItem.width / pageWidth) * 100, 2);

    regions.push({
      product: matched,
      product_code: extractedCode,
      label: rowText.trim().substring(0, 200),
      x_pct,
      y_pct: Math.max(0, y_pct),
      w_pct,
      h_pct: Math.min(100 - y_pct, h_pct),
      matched: !!matched,
      has_price: true,
      detected_price: detectedPrice,
    });
  }

  console.log(
    `[pdfExtract] Row processing: ${sortedPrices.length} price items → ` +
      `${regions.length} regions. Skipped: noPrice=${skippedCount.noPrice}, ` +
      `ghost=${skippedCount.ghost}, outOfBounds=${skippedCount.outOfBounds}`,
  );

  // Align all region icons to a single X column (rightmost)
  if (regions.length > 0) {
    const maxX = Math.max(...regions.map((r) => r.x_pct));
    for (const r of regions) r.x_pct = maxX;
  }

  return regions;
}

// ─── Cache & Entry Point ────────────────────────────────────────────────────

let _extractionVersion = 40; // v40: rightmost-column-only price gating
const extractionCache = new Map<string, ExtractedProductRegion[]>();

/**
 * Extract and match products from a PDF page, with caching.
 */
export async function extractAndMatchPage(
  pdfUrl: string,
  pageNumber: number,
  products: PaletteProduct[],
): Promise<ExtractedProductRegion[]> {
  const cacheKey = `v${_extractionVersion}:${pdfUrl}:${pageNumber}:${products.length}`;
  if (extractionCache.has(cacheKey)) {
    return extractionCache.get(cacheKey)!;
  }

  try {
    const { items, pageWidth, pageHeight } = await extractTextItemsFromPdfPage(pdfUrl, pageNumber);
    console.log(`[pdfExtract] Page ${pageNumber}: ${items.length} raw text items extracted`);

    const colRange = findPriceColumnRange(items, pageWidth, pageHeight);
    const mergedItems = mergeCurrencyWithPrices(items, colRange, pageWidth);
    console.log(
      `[pdfExtract] Page ${pageNumber}: ${mergedItems.length} items after merge ` +
        `(${items.length - mergedItems.length} merged)`,
    );

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
