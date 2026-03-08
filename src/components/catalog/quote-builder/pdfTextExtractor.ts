/**
 * PDF Text Extraction & Product Matching Utility
 *
 * v36: Complete rewrite — simple row-grouping algorithm.
 * 1. Extract all text items with x,y coords
 * 2. Merge lone "R" + adjacent digits
 * 3. Group ALL items into rows by y-position
 * 4. For each row with R-prefixed price: rightmost R-price, find model code, label = text left of price
 * 5. Match product_code to DB case-insensitive
 * 6. NO ghost filtering, NO y_pct<5% filter
 * 7. Return ALL rows sorted by y_pct
 */
import type { PaletteProduct } from "../QuoteBuilderTab";

/* ─── URL sanitization ─── */
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

/* ─── Lazy pdfjs-dist loader ─── */
let _pdfjsLib: any = null;
async function getPdfjsLib() {
  if (_pdfjsLib) return _pdfjsLib;
  const lib = await import("pdfjs-dist");
  lib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${lib.version}/pdf.worker.min.mjs`;
  _pdfjsLib = lib;
  return lib;
}

/* ─── Types ─── */
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

/* ─── Step 1: Extract text items from PDF page ─── */
export async function extractTextItemsFromPdfPage(
  pdfUrl: string,
  pageNumber: number
): Promise<{ items: ExtractedTextItem[]; pageWidth: number; pageHeight: number }> {
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

  const styles = textContent.styles || {};
  const items: ExtractedTextItem[] = [];
  for (const item of textContent.items) {
    if (!("str" in item) || !item.str.trim()) continue;
    const tx = item.transform;
    const fontSizeY = Math.abs(tx[3]) || Math.sqrt(tx[0] * tx[0] + tx[1] * tx[1]);
    const style = (item as any).fontName ? styles[(item as any).fontName] : undefined;
    const ascent = style?.ascent ?? 0.75;
    const descent = style?.descent ?? -0.25;
    const x = tx[4];
    const y = viewport.height - tx[5] - (ascent * fontSizeY);
    const width = item.width ?? item.str.length * fontSizeY * 0.6;
    const height = (ascent - descent) * fontSizeY;
    items.push({ text: item.str, x, y, width, height });
  }

  return { items, pageWidth: viewport.width, pageHeight: viewport.height };
}

/* ─── Step 2: Merge lone "R" with adjacent price digits ─── */
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

    if (trimmed.startsWith("R") && trimmed.length <= 2) {
      let bestJ = -1;
      let bestScore = Infinity;
      for (let j = i + 1; j < sorted.length; j++) {
        if (skip.has(j)) continue;
        const dy = Math.abs(sorted[j].y - item.y);
        if (dy > yThreshold) continue;
        if (sorted[j].x < item.x + item.width - 2) continue;
        const gap = sorted[j].x - (item.x + item.width);
        if (gap > item.width * 6) continue;
        const nextText = sorted[j].text.trim();
        if (!/^\d[\d\s,.]*$/.test(nextText)) continue;
        if (!/[,.]/.test(nextText) && nextText.replace(/\s/g, "").length < 4) continue;
        const score = gap + dy * 2;
        if (score < bestScore) { bestJ = j; bestScore = score; }
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

/* ─── Price detection helpers ─── */
function parseRawPrice(captured: string): number | null {
  let raw = captured.trim();
  if (/,\d{1,2}$/.test(raw) && /\.\d/.test(raw)) {
    raw = raw.replace(/\s/g, "").replace(/\./g, "").replace(/,(?=\d{1,2}$)/, ".");
  } else if (/,\d{1,2}$/.test(raw) && !/\.\d/.test(raw)) {
    raw = raw.replace(/\s/g, "").replace(/,(?=\d{1,2}$)/, ".");
  } else {
    raw = raw.replace(/[,\s]/g, "");
  }
  const val = parseFloat(raw);
  return (!isNaN(val) && val > 0) ? val : null;
}

/** Detect the LAST R-prefixed price in a text string */
function detectPrice(text: string): number | null {
  const prices: number[] = [];
  // Decimal prices: R1,024.07 / R 500.00 / R12,15 / R 1 234,56
  const re1 = /R\s*([\d\s,]+[.,]\d{1,2})/g;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(text)) !== null) {
    const val = parseRawPrice(m[1]);
    if (val !== null) prices.push(val);
  }
  // Whole number prices >= 50: R500, R 1000
  const re2 = /R\s*(\d[\d\s]*)(?![A-Za-z])/g;
  while ((m = re2.exec(text)) !== null) {
    const raw = m[1].replace(/\s/g, "");
    const val = parseFloat(raw);
    if (!isNaN(val) && val >= 50 && !prices.includes(val)) prices.push(val);
  }
  return prices.length > 0 ? prices[prices.length - 1] : null;
}

/** Check if text has an R-prefixed price */
function hasRPrice(text: string): boolean {
  return /R\s*\d/.test(text) && detectPrice(text) !== null;
}

/* ─── Step 3-7: Group into rows, find prices, match products ─── */
export function matchTextRowsToProducts(
  items: ExtractedTextItem[],
  pageWidth: number,
  pageHeight: number,
  products: PaletteProduct[]
): ExtractedProductRegion[] {
  if (items.length === 0 || pageHeight === 0) return [];

  const avgHeight = items.reduce((s, i) => s + i.height, 0) / items.length || 10;
  const yTolerance = avgHeight * 1.2;

  // ─── STEP 3: Group ALL items into rows by y-position ───
  interface Row {
    y: number;
    items: ExtractedTextItem[];
  }
  const rows: Row[] = [];
  const sortedByY = [...items].sort((a, b) => a.y - b.y);

  for (const item of sortedByY) {
    let added = false;
    for (const row of rows) {
      if (Math.abs(item.y - row.y) <= yTolerance) {
        row.items.push(item);
        added = true;
        break;
      }
    }
    if (!added) {
      rows.push({ y: item.y, items: [item] });
    }
  }

  // Sort items within each row by x
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
  }

  console.log(`[pdfExtract v36] ${items.length} items → ${rows.length} rows, avgHeight=${avgHeight.toFixed(1)}, yTolerance=${yTolerance.toFixed(1)}`);

  // ─── Build product lookup ───
  const byCode = new Map<string, PaletteProduct>();
  for (const p of products) {
    if (p.product_code) {
      byCode.set(p.product_code.toLowerCase().trim(), p);
    }
  }

  // Model code patterns
  const modelRegex1 = /^[A-Z]{2,}[0-9]/;     // e.g. FTXM25Q, MS12F
  const modelRegex2 = /^[A-Z0-9]{6,}$/;       // e.g. AR09TXHQ

  // Model/product code detection regex — must contain at least 2 letters followed by a digit
  const productCodeRegex = /[A-Z]{2}\d/;

  // ─── STEP 4-7: Process each row ───
  const regions: ExtractedProductRegion[] = [];

  for (const row of rows) {
    // Concatenate all text in row
    const allText = row.items.map(i => i.text).join(" ");

    // Find all R-price items in this row
    const rPriceItems = row.items.filter(i => hasRPrice(i.text));
    if (rPriceItems.length === 0) continue; // Skip rows without R-price

    // RIGHTMOST R-price is the detected price (Incl VAT)
    rPriceItems.sort((a, b) => b.x - a.x);
    const rightmostPriceItem = rPriceItems[0];
    const detectedPrice = detectPrice(rightmostPriceItem.text);

    if (detectedPrice === null || detectedPrice <= 0) continue;

    // Label = all text items LEFT of the rightmost price item
    const labelItems = row.items.filter(i => i.x < rightmostPriceItem.x);
    const label = labelItems.map(i => i.text).join(" ").trim();

    // BUG 2 FIX: Require at least one text item that looks like a model/product code.
    // This prevents title rows and section headers from getting icons.
    const allRowText = allText.toUpperCase();
    const hasProductCode = productCodeRegex.test(allRowText);
    if (!hasProductCode) {
      console.log(`[pdfExtract v36] SKIP (no product code): "${allText.substring(0, 80)}"`);
      continue;
    }

    // Find model code in the row
    let modelCode = "";
    for (const item of row.items) {
      const t = item.text.trim();
      if (modelRegex1.test(t) || modelRegex2.test(t)) {
        modelCode = t;
        break;
      }
    }
    // Fallback: regex search in full row text
    if (!modelCode) {
      const codeMatch = allText.match(/\b([A-Za-z]{2,}\d+[A-Za-z0-9\-]*)\b/);
      if (codeMatch) modelCode = codeMatch[1];
    }

    // ─── STEP 5: Match to DB product ───
    let matched: PaletteProduct | null = null;
    const searchCode = (modelCode || "").toLowerCase().trim();

    // Exact match on product_code
    if (searchCode && byCode.has(searchCode)) {
      matched = byCode.get(searchCode)!;
    }

    // Partial match: check if any DB code is contained in row text or vice versa
    if (!matched && searchCode.length >= 4) {
      for (const [dbCode, product] of byCode) {
        if (dbCode.length >= 4 && (searchCode.includes(dbCode) || dbCode.includes(searchCode))) {
          matched = product;
          break;
        }
      }
    }

    // Label-based match: check if any product code appears in the label
    if (!matched) {
      const labelLower = label.toLowerCase();
      for (const [dbCode, product] of byCode) {
        if (dbCode.length >= 4 && labelLower.includes(dbCode)) {
          matched = product;
          break;
        }
      }
    }

    const productCode = matched?.product_code || modelCode || `${label.substring(0, 60)}@${detectedPrice}`;
    const y_pct = (row.y / pageHeight) * 100;
    const h_pct = Math.max((avgHeight / pageHeight) * 100, 1.5);

    // Bounds check
    if (y_pct < 0 || y_pct > 100) continue;

    console.log(`[pdfExtract v36] ROW y=${y_pct.toFixed(1)}%: price=R${detectedPrice}, code="${productCode}", matched=${!!matched}, label="${label.substring(0, 60)}"`);

    regions.push({
      product: matched,
      product_code: productCode,
      label: label.substring(0, 200) || allText.substring(0, 200),
      x_pct: 95,
      y_pct: Math.max(0, y_pct),
      w_pct: 4,
      h_pct: Math.min(100 - y_pct, h_pct),
      matched: !!matched,
      has_price: true,
      detected_price: detectedPrice,
    });
  }

  // Sort by y position
  regions.sort((a, b) => a.y_pct - b.y_pct);

  // Align all icons to single X column
  if (regions.length > 0) {
    const maxX = Math.max(...regions.map(r => r.x_pct));
    for (const r of regions) r.x_pct = maxX;
  }

  console.log(`[pdfExtract v36] ${rows.length} rows → ${regions.length} priced regions`);
  return regions;
}

/* ─── Cache ─── */
let _extractionVersion = 36;
const extractionCache = new Map<string, { regions: ExtractedProductRegion[]; fullText: string }>();

export interface ExtractionResult {
  regions: ExtractedProductRegion[];
  fullText: string;
}

export async function extractAndMatchPage(
  pdfUrl: string,
  pageNumber: number,
  products: PaletteProduct[]
): Promise<ExtractedProductRegion[]> {
  const result = await extractAndMatchPageFull(pdfUrl, pageNumber, products);
  return result.regions;
}

export async function extractAndMatchPageFull(
  pdfUrl: string,
  pageNumber: number,
  products: PaletteProduct[]
): Promise<ExtractionResult> {
  const cacheKey = `v${_extractionVersion}:${pdfUrl}:${pageNumber}:${products.length}`;
  if (extractionCache.has(cacheKey)) return extractionCache.get(cacheKey)!;

  try {
    const { items, pageWidth, pageHeight } = await extractTextItemsFromPdfPage(pdfUrl, pageNumber);
    console.log(`[pdfExtract v36] Page ${pageNumber}: ${items.length} raw text items`);

    const fullText = items.map(i => i.text).join(" ");
    const mergedItems = mergeCurrencyWithPrices(items);
    console.log(`[pdfExtract v36] Page ${pageNumber}: ${mergedItems.length} items after R-merge`);

    const regions = matchTextRowsToProducts(mergedItems, pageWidth, pageHeight, products);
    console.log(`[pdfExtract v36] Page ${pageNumber}: ${regions.length} final regions`);

    const result = { regions, fullText };
    extractionCache.set(cacheKey, result);
    return result;
  } catch (err) {
    console.error("[pdfTextExtractor] Failed to extract:", err);
    return { regions: [], fullText: "" };
  }
}

export function clearExtractionCache() {
  extractionCache.clear();
  _extractionVersion++;
}
