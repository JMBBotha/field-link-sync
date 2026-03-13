/**
 * PDF Text Extraction & Product Matching Utility
 *
 * Uses pdfjs-dist to extract text items with their exact coordinates
 * from a PDF page, then cross-references against the products database.
 *
 * v41: Right-side threshold raised to 65% so blue rectangles only appear for rightmost R values. STEP 3 fallback minimum raised to R50 and skip threshold raised to <50 to eliminate ghost TOC items at source.
 */
import type { PaletteProduct } from "../QuoteBuilderTab";
import { supabase } from "@/integrations/supabase/client";
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
      .map((seg) => decodeURIComponent(seg).trim())
      .map((seg) => encodeURIComponent(seg))
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
  pageNumber: number,
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
export function mergeCurrencyWithPrices(items: ExtractedTextItem[], pageWidth?: number): ExtractedTextItem[] {
  const RIGHT_SIDE_THRESHOLD = 0.40;
  // Sort by y then x
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const result: ExtractedTextItem[] = [];
  const skip = new Set<number>();
  // Adaptive Y-threshold: use average text height, minimum 8px
  const avgHeight = sorted.length > 0 ? sorted.reduce((sum, i) => sum + i.height, 0) / sorted.length : 10;
  const yThreshold = Math.max(avgHeight * 1.2, 8);
  for (let i = 0; i < sorted.length; i++) {
    if (skip.has(i)) continue;
    const item = sorted[i];
    const trimmed = item.text.trim();
    if ((trimmed === "R" || trimmed === "R ") && (!pageWidth || (item.x / pageWidth) > RIGHT_SIDE_THRESHOLD)) {
      // Multi-fragment merge: collect up to 3 numeric fragments to the right on same row
      // Handles pdf.js splitting "R 1 000.00" into ["R", "1", "000.00"]
      const fragments: number[] = [];
      let lastRight = item.x + item.width;
      for (let j = i + 1; j < sorted.length && fragments.length < 3; j++) {
        if (skip.has(j)) continue;
        if (Math.abs(sorted[j].y - item.y) > yThreshold) continue;
        if (sorted[j].x < lastRight - 2) continue; // must be to the right
        const gap = sorted[j].x - lastRight;
        if (gap > avgHeight * 3) break; // too far away, stop looking
        const fragText = sorted[j].text.trim();
        // Must be numeric-ish fragment
        if (!/^[\d\s,.]+$/.test(fragText)) break;
        fragments.push(j);
        lastRight = sorted[j].x + sorted[j].width;
      }
      if (fragments.length > 0) {
        // Build combined string: "R" + all fragment texts, remove spaces between digits
        const combinedRaw = "R" + fragments.map(j => sorted[j].text.trim()).join(" ");
        // Remove spaces between digits (e.g. "R1 000.00" → "R1000.00") but keep R prefix
        const cleaned = "R" + combinedRaw.substring(1).replace(/(\d)\s+(\d)/g, "$1$2");
        const price = detectPrice(cleaned);
        if (price !== null && price > 0) {
          const lastFrag = sorted[fragments[fragments.length - 1]];
          console.log(`[pdfExtract] Merged ${fragments.length + 1} fragments: "${item.text}" + [${fragments.map(j => `"${sorted[j].text}"`).join(", ")}] → "${cleaned}" = R${price}`);
          result.push({
            text: cleaned,
            x: item.x,
            y: item.y,
            width: lastFrag.x + lastFrag.width - item.x,
            height: Math.max(item.height, ...fragments.map(j => sorted[j].height)),
          });
          skip.add(i);
          fragments.forEach(j => skip.add(j));
          continue;
        }
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
  // Strict: Require R prefix and at least 4 digits total (e.g., R1234 or R12,34.56), or R with decimal/comma
  const re = /R\s*([\d\s,]+[.,]\d{1,2})(?:\s|$|[^A-Za-z0-9]|,)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const digits = m[1].replace(/[\s,.]/g, "");
    if (digits.length >= 3) {
      // Min 3 digits to catch small prices like R1.50 (digits="150")
      const val = parseRawPrice(m[1]);
      if (val !== null) results.push(val);
    }
  }
  const re2 = /R\s*([\d\s,]+[.,]\d{1,2})$/g;
  while ((m = re2.exec(text)) !== null) {
    const digits = m[1].replace(/[\s,.]/g, "");
    if (digits.length >= 3) {
      const val = parseRawPrice(m[1]);
      if (val !== null && !results.includes(val)) results.push(val);
    }
  }
  // Small prices with decimals: R1.50, R4.50, R11.00 (< 4 digits total)
  const re4 = /R\s*(\d{1,3}[.,]\d{2})(?:\s|$|[^A-Za-z0-9])/g;
  while ((m = re4.exec(text)) !== null) {
    const val = parseRawPrice(m[1]);
    if (val !== null && val > 0 && !results.includes(val)) results.push(val);
  }
  // Whole number prices: Require R prefix and >= 1000 (4 digits min)
  const re3 = /R\s*(\d[\d\s]*)(?![A-Za-z])/g;
  while ((m = re3.exec(text)) !== null) {
    const raw = m[1].replace(/\s/g, "");
    if (raw.length >= 4) {
      const val = parseFloat(raw);
      if (!isNaN(val) && val >= 1000 && !results.includes(val)) results.push(val);
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
/** Check if a text item contains an R-prefixed price */
function isPriceItem(text: string): boolean {
  return detectPrice(text) !== null;
}
/**
 * Merge adjacent text items where "R" or "R<digits>" is followed by a numeric
 * continuation on the same Y-line.
 */
function mergeAdjacentPriceFragments(items: ExtractedTextItem[], yThreshold: number, pageWidth?: number): ExtractedTextItem[] {
  const RIGHT_SIDE_THRESHOLD = 0.55;
  const merged: ExtractedTextItem[] = [];
  const used = new Set<number>();
  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue;
    const item = items[i];
    const trimmed = item.text.trim();
    // Only merge R-prefixed fragments that are on the RIGHT side of the page
    if (/^R\d*$/i.test(trimmed) && !isPriceItem(item.text) && (!pageWidth || (item.x / pageWidth) > RIGHT_SIDE_THRESHOLD)) {
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
            width: items[bestJ].x + items[bestJ].width - item.x,
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
  pageHeight: number,
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
 * or fallback to right-side heuristic (x > 40% of page width).
 * Updated: Capture standalone 4+ digit numbers in rightmost if no R prefix.
 */
function findColumnPrices(items: ExtractedTextItem[], pageWidth: number, pageHeight: number, minPrice: number = 1): ExtractedTextItem[] {
  const colRange = findPriceColumnRange(items, pageWidth, pageHeight);
  const candidates: ExtractedTextItem[] = [];
  for (const item of items) {
    const t = item.text.trim();
    // Must be numeric-ish: digits with optional spaces/commas/periods
    if (!/^\d[\d\s,.]*$/.test(t)) continue;
    // Must have at least 3 digits total for standalone (no R)
    const digits = t.replace(/[\s,.]/g, "");
    if (digits.length < 3) continue;
    // Parse as price value
    let raw = t.replace(/\s/g, "");
    if (/,\d{1,2}$/.test(raw) && !/\.\d/.test(raw)) {
      raw = raw.replace(/,(?=\d{1,2}$)/, ".");
    } else {
      raw = raw.replace(/,/g, "");
    }
    const val = parseFloat(raw);
    if (isNaN(val) || val < minPrice) continue;
    const excludedVals = [32, 290, 410];
    if (excludedVals.includes(val)) continue;
    // Check if in price column or right side of page
    const inColumn = colRange && item.x >= colRange.minX && item.x <= colRange.maxX;
    const inRightSide = item.x / pageWidth > 0.40; // Lower for column-based prices to capture One Stop Shop
    if (inColumn || inRightSide) {
      candidates.push(item);
    }
  }
  return candidates;
}
/**
 * Detect if row is a table of contents, header, or non-product row.
 * TOC rows contain dotted leaders (......) or page numbers.
 * Headers are typically in top 3% with no price or model codes.
 */
function isHeaderOrNonProductRow(rowText: string, detectedPrice: number, hasModel: boolean, y_pct: number): boolean {
  // Skip empty or whitespace-only rows
  if (rowText.replace(/\s/g, "").length === 0) return true;

  // Dotted leaders (4+ consecutive dots) → TOC or index line, never a product
  if (/\.{4,}/.test(rowText)) return true;

  const lower = rowText.toLowerCase();

  // Skip header/date text regardless of price — these are NEVER products
  if (/valid\s+from|pricelist|price\s+list/i.test(rowText)) return true;
  // Standalone year (2019-2029) with no R-prefixed price is a date, not a product
  if (/\b20[1-2]\d\b/.test(rowText) && !/R\s*\d/.test(rowText)) return true;

  // Skip common non-product headers
  const headerKeywords = [
    "contents", "table of contents", "index", "page", "chapter",
    "introduction", "disclaimer", "warranty", "terms", "fourways",
  ];
  if (headerKeywords.some((kw) => lower.includes(kw))) return true;

  // Month names in footers/headers (e.g. "Fourways January 2026")
  if (/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(rowText)) return true;

  // Model codes like AR8500 where "R" is NOT a currency prefix
  if (/\bAR\s*\d{4}\b/i.test(rowText)) return true;

  // Refrigerant type labels like "Samsung R410", "R32", "R290" — only filter SHORT header-like rows
  // with no significant price. Dense product rows in R32/R410 sections must NOT be filtered.
  if (/\bR\s*(410|32|290)\b/i.test(rowText) && !hasModel && (detectedPrice < 50 || isNaN(detectedPrice))) return true;

  // Fundamental rule: no valid price → not a product
  if (detectedPrice == null || isNaN(detectedPrice) || detectedPrice <= 0) return true;

  // TOC detection: dotted leaders or trailing 1-2 digit page numbers
  if (/[.\s]{4,}\s*\d{1,2}/.test(rowText) || /^[\w\s-]+\s+[.\s]{4,}\s*\d+$/.test(rowText)) return true;
  if (/\s*\d{1,2}$/.test(rowText) && detectedPrice < 10 && !hasModel) return true;

  // Skip page headers/footers without model code
  if ((y_pct < 3 || y_pct > 97) && !hasModel) return true;

  return false;
}

/**
 * PRICE-FIRST approach v39: column-based detection for dense table PDFs.
 * Combines R-prefixed prices with column-position-based numeric prices.
 * supplierType: 'consumables' uses R1 min, 'ac_units'/default uses R50 min.
 */
export function matchTextRowsToProducts(
  items: ExtractedTextItem[],
  pageWidth: number,
  pageHeight: number,
  products: PaletteProduct[],
  supplierType?: string,
  pageIndex?: number,
): ExtractedProductRegion[] {
  const minPrice = 1; // Universal R1 floor — isHeaderOrNonProductRow handles TOC/header filtering
  console.log(`[pdfExtract] matchTextRows: supplierType=${supplierType || "unknown"}, minPrice=R${minPrice}`);
  if (items.length === 0 || pageHeight === 0) return [];

  // TOC page detection: if page text contains "Contents" and dotted leaders, skip entire page
  const allText = items.map(i => i.text).join(" ");
  if (/contents/i.test(allText) && /\.{4,}/.test(allText)) {
    console.log(`[pdfExtract] Skipping TOC page (contains "Contents" + dotted leaders)`);
    return [];
  }
  const lookup = buildProductLookup(products);
  const { byCode, byName, byDescription } = lookup;
  const mergedItems = mergeAdjacentPriceFragments(items, 3, pageWidth);
  // Adaptive Y-threshold
  const avgHeight = mergedItems.reduce((sum, i) => sum + i.height, 0) / mergedItems.length || 10;
  const yThreshold = Math.max(avgHeight * 1.5, 8);
  // STEP 1a: Explicit R-prefixed prices (works for Samsung/Daikin/Midea)
  const explicitPriceItems = mergedItems.filter(
    (item) => /R\s*\d/.test(item.text) && (item.x / pageWidth) > 0.55 && detectPrice(item.text) !== null,
  );
  // STEP 1b: Column-based numeric prices (works for dense table PDFs like One Stop)
  const columnPrices = findColumnPrices(mergedItems, pageWidth, pageHeight, minPrice);
  // Combine and deduplicate by position
  const seen = new Set<string>();
  let priceItems: ExtractedTextItem[] = [];
  for (const item of [...explicitPriceItems, ...columnPrices]) {
    const key = `${item.x.toFixed(0)},${item.y.toFixed(0)}`;
    if (!seen.has(key)) {
      seen.add(key);
      priceItems.push(item);
    }
  }

  priceItems = priceItems.filter(item => {
    const val = detectPrice(item.text);
    if (val === 410 || val === 32 || val === 290) return false;
    return true;
  });
  const colRange = findPriceColumnRange(mergedItems, pageWidth, pageHeight);
  console.log(
    `[pdfExtract] matchTextRows: ${mergedItems.length} items, yThreshold=${yThreshold.toFixed(1)}, explicit R-prices=${explicitPriceItems.length}, column-based prices=${columnPrices.length}, combined unique=${priceItems.length}, priceColumnRange=${colRange ? `${colRange.minX.toFixed(0)}-${colRange.maxX.toFixed(0)}` : "none (using x>25% fallback)"}, pageWidth=${pageWidth.toFixed(0)}`,
  );
  if (priceItems.length === 0) return [];
  // STEP 2: Create one row per individual price item (no grouping).
  const sortedPrices = [...priceItems].sort((a, b) => a.y - b.y);
  const priceRows: { items: ExtractedTextItem[] }[] = sortedPrices.map((p) => ({ items: [p] }));
  // Model code regex - broad enough for Samsung, Daikin, Midea
  const modelRegex = /^[A-Za-z0-9\-\/]{5,}$/;
  // STEP 3: For each price row, gather context and build a region
  let regions: ExtractedProductRegion[] = [];
  let skippedCount = { noPrice: 0, ghost: 0, outOfBounds: 0 };
  const assignedCodes = new Set<string>();
  const allProductCodes = [...byCode.keys()];
  for (const pRow of priceRows) {
    const rightmost = pRow.items[pRow.items.length - 1];
    const rowAvgY = pRow.items.reduce((s, i) => s + i.y, 0) / pRow.items.length;
    // Ghost filter: skip if in top 3% AND no model code nearby
    const y_pct = (rowAvgY / pageHeight) * 100;
    // TIGHT same-row context ONLY (no aboveItems, no wide band)
    const tightBand = avgHeight * 0.6;
    const contextItems = mergedItems.filter((it) => Math.abs(it.y - rowAvgY) <= tightBand);
    const hasModel = contextItems.some((i) => modelRegex.test(i.text.trim()));
    const rowText = contextItems.map((it) => it.text).join(" ");
    const looseRowText = pRow.items.map((it) => it.text).join(" ");

    // FUNDAMENTAL RULE: Skip entire row if rightmost price item is on LEFT side of page
    const rightmostXPct = rightmost.x / pageWidth;
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
      if (!isNaN(val) && val >= minPrice) detectedPrice = val;
    }

    // Skip samsung/R410 section headers ONLY when tight-band row looks like a header (no real price)
    if (/samsung.*r\s*410|r\s*410.*kw/i.test(rowText) && (detectedPrice === null || detectedPrice < 50)) continue;

    const headerOrNonProduct = isHeaderOrNonProductRow(rowText, detectedPrice ?? NaN, hasModel, y_pct);

    if (rightmostXPct <= 0.55) {
      console.log(`[pdfExtract] BLOCKED left-side price row: text="${rightmost.text}" xPct=${(rightmostXPct * 100).toFixed(1)}% (must be >55%)`);
      skippedCount.ghost++;
      continue;
    }
    console.log(
      `[pdfExtract] STEP3 row: rightText="${rightmost.text}" x=${rightmost.x.toFixed(1)} xPct=${((rightmost.x / pageWidth) * 100).toFixed(1)}% detectedPrice=${detectedPrice}`,
    );
    if (detectedPrice === null || detectedPrice < minPrice) {
      skippedCount.noPrice++;
      console.log(`[pdfExtract] Skipped noPrice (min R${minPrice}): ${rightmost.text} at y=${rightmost.y}`);
      continue;
    }
    if (headerOrNonProduct) {
      skippedCount.ghost++;
      console.log(
        `[pdfExtract] Skipped ghost: ${rowText} at y_pct=${y_pct.toFixed(1)}, detectedPrice=${detectedPrice}`,
      );
      continue;
    }
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
    if (!matched && hasModel) {
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
    if (!matched && hasModel) {
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
    const anchorHeight = rightmost.height;
    const h_pct = Math.max((anchorHeight / pageHeight) * 100, 0.8);
    if (y_pct > 100 || h_pct > 5) {
      skippedCount.outOfBounds++;
      continue;
    }
    // Use ACTUAL price item coordinates for icon alignment (not hardcoded)
    const actualX_pct = (rightmost.x / pageWidth) * 100;
    const actualW_pct = Math.max((rightmost.width / pageWidth) * 100, 2);
    // Allow unmatched rows through — they appear as blue "new" rectangles
    console.log(`[pdfExtract] ADDING REGION: label="${rowText.trim().substring(0,200)}" price=${detectedPrice} matched=${!!matched} y_pct=${y_pct.toFixed(1)} code="${extractedCode}"`);
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
  console.log(
    `[pdfExtract] Row processing: ${priceRows.length} price rows → ${regions.length} regions. Skipped: noPrice=${skippedCount.noPrice}, ghost=${skippedCount.ghost}, outOfBounds=${skippedCount.outOfBounds}`,
  );
  // Align all icons to a single X column
  if (regions.length > 0) {
    const maxX = Math.max(...regions.map((r) => r.x_pct));
    for (const r of regions) r.x_pct = maxX;
  }
  return regions;
}
// Cache for extracted regions per page
let _extractionVersion = 75; // v75: revert 0.45/tightBand/dedup regressions, keep hasModel gate, add 0.40 for column prices only
const extractionCache = new Map<string, ExtractedProductRegion[]>();
/**
 * Extract and match products from a PDF page, with caching.
 */
export async function extractAndMatchPage(
  pdfUrl: string,
  pageNumber: number,
  products: PaletteProduct[],
  supplierId?: string,
  supplierType?: string,
): Promise<ExtractedProductRegion[]> {
  const cacheKey = `v${_extractionVersion}:${pdfUrl}:${pageNumber}:${products.length}`;
  if (extractionCache.has(cacheKey)) {
    return extractionCache.get(cacheKey)!;
  }
  try {
    const { items, pageWidth, pageHeight } = await extractTextItemsFromPdfPage(pdfUrl, pageNumber);
    // DEBUG 1: Total raw text items from pdf.js
    console.log(`[PDF-DEBUG] Page ${pageNumber}: ${items.length} total raw text items, supplierType="${supplierType || "NOT SET"}", supplierId="${supplierId || "none"}"`);

    // FALLBACK: If pdf.js returns 0 text items (scanned/image-based page),
    // return empty — the UI layer (VisualCatalogPanel) shows a banner instead
    if (items.length === 0) {
      console.log(`[PDF-DEBUG] Page ${pageNumber}: pdf.js returned 0 text items (scanned/image page) - returning empty, UI will show banner`);
      extractionCache.set(cacheKey, []);
      return [];
    }
    
    // DEBUG 5: Log first 10 text items for page 1 to see what pdf.js extracts
    if (pageNumber === 1) {
      const first10 = items.slice(0, 10);
      first10.forEach((item, idx) => {
        console.log(`[PDF-DEBUG] Page 1 item[${idx}]: x=${item.x.toFixed(1)} y=${item.y.toFixed(1)} w=${item.width.toFixed(1)} h=${item.height.toFixed(1)} text="${item.text}"`);
      });
      // Also log ALL items that contain "R" followed by digits (potential prices)
      const rPriceItems = items.filter(i => /R\s*\d/.test(i.text));
      console.log(`[PDF-DEBUG] Page 1: ${rPriceItems.length} items containing R+digits pattern`);
      rPriceItems.slice(0, 10).forEach((item, idx) => {
        console.log(`[PDF-DEBUG] Page 1 R-item[${idx}]: x=${item.x.toFixed(1)} y=${item.y.toFixed(1)} text="${item.text}" xPct=${((item.x / pageWidth) * 100).toFixed(1)}%`);
      });
    }

    const mergedItems = mergeCurrencyWithPrices(items, pageWidth);
    console.log(`[PDF-DEBUG] Page ${pageNumber}: ${mergedItems.length} items after mergeCurrencyWithPrices (${items.length - mergedItems.length} merged)`);
    
    // Log sample of lone "R" items and standalone numeric items for debugging
    const loneRItems = mergedItems.filter((i) => i.text.trim() === "R");
    const numericItems = mergedItems.filter((i) => /^\d[\d\s,.]+$/.test(i.text.trim()));
    console.log(`[PDF-DEBUG] Page ${pageNumber}: ${loneRItems.length} lone "R" items remaining, ${numericItems.length} standalone numeric items`);
    if (loneRItems.length > 0) {
      loneRItems.slice(0, 10).forEach((r) => console.log(`[PDF-DEBUG] Page ${pageNumber} lone-R at x=${r.x.toFixed(1)} y=${r.y.toFixed(1)}`));
    }
    if (numericItems.length > 0) {
      numericItems.slice(0, 10).forEach((n) =>
        console.log(`[PDF-DEBUG] Page ${pageNumber} numeric at x=${n.x.toFixed(1)} y=${n.y.toFixed(1)} text="${n.text.trim()}" xPct=${((n.x / pageWidth) * 100).toFixed(1)}%`),
      );
    }
    
    // DEBUG 2: Explicit R-prefixed items (pre-matchTextRows check)
    const preCheckExplicit = mergedItems.filter(
      (item) => /R\s*\d/.test(item.text) && detectPrice(item.text) !== null && item.x / pageWidth > 0.55,
    );
    console.log(`[PDF-DEBUG] Page ${pageNumber}: STEP 1a - ${preCheckExplicit.length} R-prefixed price items with x > 40% pageWidth`);
    preCheckExplicit.slice(0, 10).forEach((item, idx) => {
      console.log(`[PDF-DEBUG] Page ${pageNumber} explicit[${idx}]: text="${item.text}" x=${item.x.toFixed(1)} xPct=${((item.x / pageWidth) * 100).toFixed(1)}% price=${detectPrice(item.text)}`);
    });
    
    // DEBUG 3: Column prices check
    const preCheckColumn = findColumnPrices(mergedItems, pageWidth, pageHeight);
    console.log(`[PDF-DEBUG] Page ${pageNumber}: STEP 1b - ${preCheckColumn.length} column-based prices found`);
    preCheckColumn.slice(0, 10).forEach((item, idx) => {
      console.log(`[PDF-DEBUG] Page ${pageNumber} colPrice[${idx}]: text="${item.text}" x=${item.x.toFixed(1)} xPct=${((item.x / pageWidth) * 100).toFixed(1)}%`);
    });
    
    // DEBUG: Price column header detection
    const colRange = findPriceColumnRange(mergedItems, pageWidth, pageHeight);
    console.log(`[PDF-DEBUG] Page ${pageNumber}: Price column header range = ${colRange ? `${colRange.minX.toFixed(0)}-${colRange.maxX.toFixed(0)}` : 'NOT FOUND'}`);

    let regions = matchTextRowsToProducts(mergedItems, pageWidth, pageHeight, products, supplierType, pageNumber - 1);
    // DEBUG 4: Final regions count
    console.log(`[PDF-DEBUG] Page ${pageNumber}: STEP 3 - ${regions.length} regions created from matchTextRowsToProducts`);
    // New dedup: Sort by y_pct, if within adaptive threshold, keep priced one
    regions = regions.sort((a, b) => a.y_pct - b.y_pct);
    const avgHeight = mergedItems.length > 0 ? mergedItems.reduce((sum, i) => sum + i.height, 0) / mergedItems.length : 10;
    const deduped = [];
    let ghostsRemoved = 0;
    let overlapsFixed = 0;
    for (let i = 0; i < regions.length; i++) {
      const current = regions[i];
      let isDuplicate = false;
      for (let j = 0; j < deduped.length; j++) {
        const existing = deduped[j];
        // Adaptive dedup threshold based on actual row height
        const minDyForDedup = avgHeight * 0.15;
        const adaptiveDedupThreshold = (minDyForDedup / pageHeight) * 100;
        if (Math.abs(current.y_pct - existing.y_pct) < adaptiveDedupThreshold) {
          // Keep the one with price (detected_price > 0)
          if (current.detected_price > 0 && existing.detected_price <= 0) {
            deduped[j] = current;
          }
          isDuplicate = true;
          ghostsRemoved++;
          console.log(`[pdfExtract] Dedup removed ghost/duplicate at y_pct=${current.y_pct.toFixed(2)}`);
          break;
        }
      }
      if (!isDuplicate) {
        deduped.push(current);
      }
    }
    regions = deduped;

    // Anti-overlap: Clamp h_pct to not extend past next y_pct, with 0.2% gap
    for (let i = 0; i < regions.length - 1; i++) {
      const current = regions[i];
      const nextY = regions[i + 1].y_pct;
      const maxH = nextY - current.y_pct - 0.05; // 0.05% gap
      if (current.h_pct > maxH) {
        current.h_pct = maxH;
        overlapsFixed++;
        console.log(
          `[pdfExtract] Fixed overlap at y_pct=${current.y_pct.toFixed(2)}, clamped h_pct to ${maxH.toFixed(2)}`,
        );
      }
    }

    console.log(
      `[pdfExtract] Page ${pageNumber}: ${regions.length} final regions after dedup. Ghosts removed: ${ghostsRemoved}, Overlaps fixed: ${overlapsFixed}`,
    );
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
