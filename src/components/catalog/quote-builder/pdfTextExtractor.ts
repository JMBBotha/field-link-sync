/**
 * PDF Text Extraction & Product Matching Utility
 *
 * Uses pdfjs-dist to extract text items with their exact coordinates
 * from a PDF page, then cross-references against the products database.
 *
 * Requires the original PDF URL (pdf_storage_path on supplier_pdf_pages).
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
    // PDF coordinates: origin is bottom-left, Y goes up
    // Convert to top-left origin for overlay positioning
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
 * Group adjacent text items into rows based on Y-coordinate proximity.
 * Items within `threshold` pixels of each other vertically are grouped.
 * Uses adaptive threshold: starts with base, widens if rows seem too fragmented.
 */
function groupTextItemsIntoRows(
  items: ExtractedTextItem[],
  threshold = 6
): ExtractedTextItem[][] {
  if (items.length === 0) return [];

  const sorted = [...items].sort((a, b) => a.y - b.y);

  // Adaptive threshold: measure median row gap to pick a better threshold
  const gaps: number[] = [];
  for (let i = 1; i < Math.min(sorted.length, 200); i++) {
    const gap = sorted[i].y - sorted[i - 1].y;
    if (gap > 0.5) gaps.push(gap);
  }
  gaps.sort((a, b) => a - b);
  const medianGap = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : threshold;
  // Use 60% of median gap as threshold (items closer than this are same row)
  const adaptiveThreshold = Math.max(threshold, medianGap * 0.6);

  const rows: ExtractedTextItem[][] = [];
  let currentRow: ExtractedTextItem[] = [sorted[0]];
  let currentY = sorted[0].y;

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].y - currentY > adaptiveThreshold) {
      rows.push(currentRow);
      currentRow = [];
      currentY = sorted[i].y;
    }
    currentRow.push(sorted[i]);
  }
  if (currentRow.length > 0) rows.push(currentRow);

  // Sort items within each row by X position
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
  }

  return rows;
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
    // Index by description keywords for consumable-type suppliers
    if (p.description) {
      // Use the first meaningful portion of the description (before any " - " separator)
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
 * Rejects model codes like R32, R410A where R+digits is part of a model identifier.
 */
function detectPrice(text: string): number | null {
  // Try decimal prices first (most reliable — e.g. R1,738.26, R260.74, R12,15)
  const decimalMatch = text.match(/R\s*([\d\s,]+[.,]\d{1,2})\b/);
  if (decimalMatch) {
    let raw = decimalMatch[1].trim();
    // Determine if comma is decimal separator (SA style) or thousands separator
    if (/,\d{1,2}$/.test(raw) && !/\.\d/.test(raw)) {
      // SA format: R12,15 or R1 234,56 — comma is decimal
      raw = raw.replace(/\s/g, "").replace(/,(?=\d{1,2}$)/, ".");
    } else {
      // Standard: R1,500.00 — comma is thousands
      raw = raw.replace(/[,\s]/g, "");
    }
    const val = parseFloat(raw);
    if (!isNaN(val) && val >= 1) return val;
  }

  // Whole number prices >= 50, but NOT followed immediately by a letter (rejects R32W, R410A)
  const wholeMatch = text.match(/R\s*(\d{2,}(?:\s\d{3})*)(?![A-Za-z])/);
  if (wholeMatch) {
    const raw = wholeMatch[1].replace(/\s/g, "");
    const val = parseFloat(raw);
    if (!isNaN(val) && val >= 50) return val;
  }

  return null;
}

/** Detect if a row has a real R-prefixed price (strict — excludes model codes) */
function hasRealPrice(text: string): boolean {
  return detectPrice(text) !== null;
}

/** Phrases that indicate descriptive text, never found in product model rows */
const DESCRIPTION_PHRASES = [
  "can be", "is fitted", "reduces", "automatically", "ensure",
  "renowned", "operating", "standby", "consumption", "simultaneously",
  "heating or cooling mode", "outdoor units", "swing compressor",
  "low noise output", "high energy efficiency", "neat, sturdy",
  "easily be mounted", "roof or terrace", "energy saving", "standby mode",
  "current consumption", "about 80%", "unique design", "integrates fully",
  "no false ceiling", "free floor space", "decoration panel",
  "for wide rooms", "suitable for", "designed for", "equipped with",
];

/** Branding / boilerplate tokens that indicate a ghost row (not a product) */
const GHOST_PHRASES = [
  "pricing is subject", "subject to availability", "prices subject",
  "all prices", "terms and conditions", "e&oe", "errors and omissions",
  "page ", "tel:", "fax:", "email:", "www.", ".co.za", ".com",
  "head office", "branch", "warehouse", "copyright", "©",
  "vat included", "vat excl", "incl vat", "excl vat",
  "price list", "pricelist", "catalogue", "catalog",
];

/**
 * Detect ghost rows: headers, footers, banners, branding text that should NOT
 * get overlay icons. Call AFTER converting to percentage coordinates.
 */
function isGhostRow(
  text: string,
  y_pct: number,
  hasPrice: boolean,
  hasProductCode: boolean
): boolean {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  // Very short text with no product code → ghost
  if (trimmed.length < 10 && !hasProductCode) return true;

  // Top 8% of page → likely header / banner
  if (y_pct < 8) return true;

  // Bottom 10% without both a valid code AND price → likely footer
  if (y_pct > 90 && !(hasProductCode && hasPrice)) return true;

  // ALL-CAPS branding text with no digits at all (e.g. "ALLIANCE", "SAMSUNG")
  if (/^[A-Z\s/&®™-]+$/.test(trimmed) && !/\d/.test(trimmed) && trimmed.length < 40) return true;

  // Contains known ghost/boilerplate phrases
  if (GHOST_PHRASES.some(phrase => lower.includes(phrase))) return true;

  return false;
}

/** Count how many real R-prefixed price values appear in text */
function countPrices(text: string): number {
  // Count by finding all R+decimal patterns, then R+whole number patterns
  const decimalMatches = text.match(/R\s*[\d\s,]+[.,]\d{1,2}\b/g) || [];
  const wholeMatches = text.match(/R\s*\d{3,}(?![A-Za-z])/g) || [];
  // Deduplicate by position would be complex, so just use the max
  return Math.max(decimalMatches.length, decimalMatches.length + wholeMatches.length);
}

/**
 * Detect if a catalog is "HVAC style" (Samsung, Daikin, etc.) vs consumable/materials.
 */
function detectCatalogStyle(products: PaletteProduct[]): "hvac" | "consumable" {
  if (products.length === 0) return "consumable";

  const hvacModelRegex = /^(AR|AJ|AE|AC|AM|AN|AP|DVM|FTK|FTX|RXS|RXL|ARXG|ASYG|MSZ|MUZ|RAK|RAS|ALL|FOUR)\d/i;
  let hvacStyleCount = 0;

  for (const p of products) {
    const code = (p.product_code || "").trim();
    if (hvacModelRegex.test(code)) {
      hvacStyleCount++;
    }
  }

  return hvacStyleCount > products.length * 0.2 ? "hvac" : "consumable";
}

/**
 * Check if a text row looks like a real product line item (not a description).
 */
function isProductRow(text: string, relaxed = false): boolean {
  const trimmed = text.trim();

  if (trimmed.length < 6) return false;
  if (trimmed.startsWith("•") || trimmed.startsWith("-") || trimmed.startsWith("–")) return false;
  if (trimmed.length > (relaxed ? 250 : 120)) return false;

  const lower = trimmed.toLowerCase();
  if (DESCRIPTION_PHRASES.some(phrase => lower.includes(phrase))) return false;

  if (relaxed) {
    const isSectionHeader = /^[A-Z\s/&-]+$/.test(trimmed) && !/\d/.test(trimmed);
    if (isSectionHeader) return false;
    if (/^(item|code|description|product|price|qty|total|unit)\b/i.test(trimmed)) return false;

    let score = 0;
    score += 1; // meaningful text content
    if (hasRealPrice(trimmed)) score += 1;
    const numMatch = trimmed.match(/\b(\d+[.,]\d{2})\b/);
    if (numMatch) {
      const numVal = parseFloat(numMatch[1].replace(",", "."));
      if (numVal > 1.0) score += 1;
    }
    return score >= 2;
  }

  // Strict mode: require a strict HVAC-style model code + 2 prices
  const modelCodeRegex = /\b[A-Z]{2,5}[A-Z0-9]{2,}\d{1,3}[A-Z0-9]*\b/;
  if (!modelCodeRegex.test(trimmed)) return false;
  if (countPrices(trimmed) < 2) return false;

  return true;
}

/**
 * Merge consecutive rows into "product groups" for table-layout PDFs.
 * A product group is a set of consecutive rows ending with (or containing) a price row.
 * Non-price rows (e.g., multi-line features) are merged into the next price row's group.
 * This ensures one icon per product, anchored to the price row.
 */
function mergeRowsIntoProductGroups(
  rows: ExtractedTextItem[][]
): { allItems: ExtractedTextItem[]; priceRow: ExtractedTextItem[]; fullText: string }[] {
  const groups: { allItems: ExtractedTextItem[]; priceRow: ExtractedTextItem[]; fullText: string }[] = [];
  let pendingRows: ExtractedTextItem[][] = [];

  for (const row of rows) {
    const rowText = row.map(i => i.text).join(" ");
    pendingRows.push(row);

    if (hasRealPrice(rowText)) {
      // This row has a real price — finalize the product group
      const allItems = pendingRows.flat();
      const fullText = pendingRows.map(r => r.map(i => i.text).join(" ")).join(" ");
      groups.push({ allItems, priceRow: row, fullText });
      pendingRows = [];
    }
  }

  // Trailing rows without a price are discarded (no icon for them)
  return groups;
}

/**
 * Match extracted text rows against products database.
 * Returns positioned regions with matched/unmatched status.
 * Only creates regions for rows with detected prices.
 * Icons are anchored to the price text item's y-coordinate, at a fixed x of ~95%.
 */
export function matchTextRowsToProducts(
  items: ExtractedTextItem[],
  pageWidth: number,
  pageHeight: number,
  products: PaletteProduct[]
): ExtractedProductRegion[] {
  const rows = groupTextItemsIntoRows(items);
  const { byCode, byName, byDescription } = buildProductLookup(products);

  // Determine catalog style
  const productStyle = detectCatalogStyle(products);
  const sampleRows = rows.slice(0, 60).map(r => r.map(i => i.text).join(" "));
  const rowsWithTwoPrices = sampleRows.filter(r => countPrices(r) >= 2).length;
  const rowsWithOnePrice = sampleRows.filter(r => hasRealPrice(r)).length;
  const pdfStyleIsConsumable = rowsWithOnePrice > 5 && rowsWithTwoPrices < rowsWithOnePrice * 0.3;
  const isRelaxedCatalog = productStyle === "consumable" || pdfStyleIsConsumable;

  console.log(`[pdfTextExtractor] Total text rows: ${rows.length}, Products: ${products.length}, Style: products=${productStyle}, pdfConsumable=${pdfStyleIsConsumable}, relaxed: ${isRelaxedCatalog}`);

  // Merge rows into product groups (multi-line features merged with their price row)
  const productGroups = mergeRowsIntoProductGroups(rows);

  console.log(`[pdfTextExtractor] Merged ${rows.length} rows into ${productGroups.length} product groups (each has a price)`);

  const regions: ExtractedProductRegion[] = [];
  const seenProductCodes = new Set<string>();
  let ghostCount = 0;

  for (const group of productGroups) {
    const { allItems, priceRow, fullText } = group;
    const fullTextLower = fullText.toLowerCase();

    // Skip very short text
    if (fullText.trim().length < 3) continue;

    // Detect the price from the price row
    const priceRowText = priceRow.map(i => i.text).join(" ");
    const detectedPrice = detectPrice(priceRowText);
    if (detectedPrice === null) continue; // Safety: skip if no price detected

    // Find the exact y-coordinate of the rightmost price text item
    const priceItemRegex = /R\s*[\d\s,]+(?:[.,]\d{1,2})?/;
    let anchorY = Math.min(...priceRow.map(i => i.y));
    let anchorHeight = Math.max(...priceRow.map(i => i.height));

    // Scan for the LAST (rightmost) price item — likely the INC VAT column
    for (const item of priceRow) {
      if (priceItemRegex.test(item.text)) {
        anchorY = item.y;
        anchorHeight = item.height;
        // Don't break — keep scanning for the rightmost one
      }
    }

    // Ghost row check
    const y_pct_check = (anchorY / pageHeight) * 100;
    const hasCodePattern = /\b[A-Z]{2,}\d+[A-Z0-9]*\b/i.test(fullText);
    if (isGhostRow(fullText, y_pct_check, true, hasCodePattern)) {
      ghostCount++;
      continue;
    }

    // Try to match by product code
    let matched: PaletteProduct | null = null;
    let matchedCode = "";

    for (const [code, product] of byCode) {
      if (code.length >= 3 && fullTextLower.includes(code)) {
        matched = product;
        matchedCode = product.product_code;
        break;
      }
    }

    // Fall back to short_name matching
    if (!matched) {
      for (const [name, product] of byName) {
        if (name.length >= 5 && fullTextLower.includes(name)) {
          matched = product;
          matchedCode = product.product_code;
          break;
        }
      }
    }

    // Fall back to description matching for consumable-type
    if (!matched && isRelaxedCatalog) {
      for (const [desc, product] of byDescription) {
        if (desc.length >= 8 && fullTextLower.includes(desc)) {
          matched = product;
          matchedCode = product.product_code;
          break;
        }
      }
    }

    // For unmatched rows, validate as product row
    if (!matched && !isProductRow(fullText, isRelaxedCatalog)) continue;

    // Extract product_code for dedup
    const extractedCode = matchedCode || (() => {
      const codeMatch = fullText.match(/\b([A-Z]{2,}\d+[A-Z0-9]*)\b/);
      if (codeMatch) return codeMatch[1];
      // Include price in key to differentiate similar rows with different prices
      const priceTag = detectedPrice ? `@${detectedPrice}` : "";
      return fullText.trim().substring(0, 80) + priceTag;
    })();

    // Deduplicate by product_code
    const codeKey = extractedCode.toLowerCase().trim();
    if (codeKey.length >= 3 && codeKey.length < 40 && seenProductCodes.has(codeKey)) continue;
    if (codeKey.length >= 3 && codeKey.length < 40) seenProductCodes.add(codeKey);

    // Convert to percentage coordinates — anchored to price item
    const y_pct = (anchorY / pageHeight) * 100;
    const x_pct = 95; // Fixed right edge for all icons
    const w_pct = 4; // Narrow icon width
    const h_pct = Math.max((anchorHeight / pageHeight) * 100, 1.5); // Minimum height

    // Bounds check
    if (y_pct < 0 || y_pct > 100 || h_pct > 5) continue;

    const trimmedLabel = fullText.trim().substring(0, 200);
    if (!trimmedLabel || trimmedLabel.length < 2) continue;

    regions.push({
      product: matched,
      product_code: extractedCode,
      label: trimmedLabel,
      x_pct: Math.max(0, Math.min(x_pct, 96)),
      y_pct: Math.max(0, y_pct),
      w_pct,
      h_pct: Math.min(100 - y_pct, h_pct),
      matched: !!matched,
      has_price: true,
      detected_price: detectedPrice,
    });
  }

  // Second dedup: group by rounded y_pct, keep matched over unmatched
  const yBuckets = new Map<number, number>();
  const finalDeduped: ExtractedProductRegion[] = [];
  for (let i = 0; i < regions.length; i++) {
    const bucket = Math.round(regions[i].y_pct / 1.5) * 1.5;
    const existing = yBuckets.get(bucket);
    if (existing !== undefined) {
      // Prefer matched over unmatched
      if (regions[i].matched && !finalDeduped[existing].matched) {
        finalDeduped[existing] = regions[i];
      }
    } else {
      yBuckets.set(bucket, finalDeduped.length);
      finalDeduped.push(regions[i]);
    }
  }

  const matchedCount = finalDeduped.filter(r => r.matched).length;
  const unmatchedCount = finalDeduped.filter(r => !r.matched).length;
  console.log(`[pdfTextExtractor] Results: ${finalDeduped.length} regions (${matchedCount} matched, ${unmatchedCount} unmatched), ${ghostCount} ghost rows filtered, ${regions.length - finalDeduped.length} y-bucket deduped`);

  return finalDeduped;
}

// Cache for extracted regions per page — versioned to bust on logic changes
let _extractionVersion = 15; // v15: product group merging + price anchoring + model code rejection
const extractionCache = new Map<
  string,
  ExtractedProductRegion[]
>();

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

    const regions = matchTextRowsToProducts(
      items,
      pageWidth,
      pageHeight,
      products
    );

    extractionCache.set(cacheKey, regions);
    return regions;
  } catch (err) {
    console.error("[pdfTextExtractor] Failed to extract:", err);
    return [];
  }
}

/**
 * Clear the extraction cache (e.g., when products change or panel reopens).
 * Bumps version to ensure no stale entries are reused.
 */
export function clearExtractionCache() {
  extractionCache.clear();
  _extractionVersion++;
}
