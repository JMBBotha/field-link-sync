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
 */
function detectPrice(text: string): number | null {
  // Match R-prefixed prices with flexible formatting:
  // R12,15 (SA comma decimal), R 500.00, R1 234,56, R150, R1,500.00
  const rPriceMatch = text.match(/R\s*([\d\s,]+(?:[.,]\d{1,2})?)/);
  if (rPriceMatch) {
    let raw = rPriceMatch[1].trim();
    // Determine if comma is decimal separator (SA style) or thousands separator
    // If string ends with ,XX (1-2 digits after last comma), treat comma as decimal
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
  return null;
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

/** Count how many R-prefixed price values appear in text (handles SA formats) */
function countPrices(text: string): number {
  const matches = text.match(/R\s*[\d\s,]+(?:[.,]\d{1,2})?/g);
  return matches ? matches.length : 0;
}

/** Detect if a row has an R-prefixed price (very permissive) */
function hasAnyPrice(text: string): boolean {
  return /R\s*\d/.test(text);
}

/**
 * Detect if a catalog is "HVAC style" (Samsung, Daikin, etc.) vs consumable/materials.
 * HVAC catalogs have multi-price columns and complex model codes like AR09TXHQA.
 * Consumable catalogs have simple codes like ALU001, BRAC01 and typically 1 price column.
 */
function detectCatalogStyle(products: PaletteProduct[]): "hvac" | "consumable" {
  if (products.length === 0) return "consumable";

  // True HVAC model codes: brand prefix + series with kW/BTU-related digits
  // e.g., AR09TXHQA, AJ020TNTDKH, FTK25TV1, etc.
  const hvacModelRegex = /^(AR|AJ|AE|AC|AM|AN|AP|DVM|FTK|FTX|RXS|RXL|ARXG|ASYG|MSZ|MUZ|RAK|RAS|ALL|FOUR)\d/i;
  let hvacStyleCount = 0;

  for (const p of products) {
    const code = (p.product_code || "").trim();
    if (hvacModelRegex.test(code)) {
      hvacStyleCount++;
    }
  }

  // If more than 20% of products look like HVAC models, treat as HVAC catalog
  return hvacStyleCount > products.length * 0.2 ? "hvac" : "consumable";
}

/**
 * Check if a text row looks like a real product line item (not a description).
 * Two modes:
 *   - Strict (HVAC): requires model code + 2 prices
 *   - Relaxed (consumable): scoring system — text content + price = valid row
 */
function isProductRow(text: string, relaxed = false): boolean {
  const trimmed = text.trim();

  // Always exclude empty or very short rows
  if (trimmed.length < 6) return false;

  // Exclude bullet points and dashes
  if (trimmed.startsWith("•") || trimmed.startsWith("-") || trimmed.startsWith("–")) return false;

  // Exclude long prose (product rows are typically short tabular data)
  if (trimmed.length > (relaxed ? 250 : 120)) return false;

  // Exclude lines with common description phrases
  const lower = trimmed.toLowerCase();
  if (DESCRIPTION_PHRASES.some(phrase => lower.includes(phrase))) return false;

  if (relaxed) {
    // --- Consumable / materials mode: scoring system ---

    // Section headers — ALL CAPS with no numbers at all (e.g. "ALUMINIUM", "BRACKETS")
    const isSectionHeader = /^[A-Z\s/&-]+$/.test(trimmed) && !/\d/.test(trimmed);
    if (isSectionHeader) return false;

    // Skip rows that look like column headers
    if (/^(item|code|description|product|price|qty|total|unit)\b/i.test(trimmed)) return false;

    // Scoring: +1 for readable text content, +1 for R-prefixed price
    let score = 0;

    // +1 for having meaningful text content (6+ chars, already checked above)
    score += 1;

    // +1 for having an R-prefixed price
    if (hasAnyPrice(trimmed)) score += 1;

    // +1 for having a standalone numeric value > 1.00 (price without R prefix)
    const numMatch = trimmed.match(/\b(\d+[.,]\d{2})\b/);
    if (numMatch) {
      const numVal = parseFloat(numMatch[1].replace(",", "."));
      if (numVal > 1.0) score += 1;
    }

    // Score >= 2 means valid product row (text + price)
    return score >= 2;
  }

  // Strict mode: require a strict HVAC-style model code + 2 prices
  const modelCodeRegex = /\b[A-Z]{2,5}[A-Z0-9]{2,}\d{1,3}[A-Z0-9]*\b/;
  if (!modelCodeRegex.test(trimmed)) return false;
  if (countPrices(trimmed) < 2) return false;

  return true;
}

/**
 * Match extracted text rows against products database.
 * Returns positioned regions with matched/unmatched status.
 * Regions with price data are always included (even if unmatched).
 */
export function matchTextRowsToProducts(
  items: ExtractedTextItem[],
  pageWidth: number,
  pageHeight: number,
  products: PaletteProduct[]
): ExtractedProductRegion[] {
  const rows = groupTextItemsIntoRows(items);
  const { byCode, byName, byDescription } = buildProductLookup(products);
  const regions: ExtractedProductRegion[] = [];

  // Determine catalog style from products AND from actual PDF text
  const productStyle = detectCatalogStyle(products);
  
  // Also scan PDF rows: if most rows have only 1 price, it's consumable-style
  const sampleRows = rows.slice(0, 60).map(r => r.map(i => i.text).join(" "));
  const rowsWithTwoPrices = sampleRows.filter(r => countPrices(r) >= 2).length;
  const rowsWithOnePrice = sampleRows.filter(r => hasAnyPrice(r)).length;
  const pdfStyleIsConsumable = rowsWithOnePrice > 5 && rowsWithTwoPrices < rowsWithOnePrice * 0.3;
  
  // Use relaxed mode if EITHER the products or the PDF text suggest consumable-style
  const isRelaxedCatalog = productStyle === "consumable" || pdfStyleIsConsumable;

  // Debug: count rows that pass/fail the filter
  let passedRows = 0;
  let failedRows = 0;
  let skippedShort = 0;

  console.log(`[pdfTextExtractor] Total text rows from PDF: ${rows.length}, Products for matching: ${products.length}, Catalog style: products=${productStyle}, pdfConsumable=${pdfStyleIsConsumable}, relaxed: ${isRelaxedCatalog}, sampled: ${sampleRows.length}, hasPrice: ${rowsWithOnePrice}, has2Prices: ${rowsWithTwoPrices}`);
  console.log(`[pdfTextExtractor] byCode entries: ${byCode.size}, byName entries: ${byName.size}, byDescription entries: ${byDescription.size}`);
  // Log first 5 product codes for debugging
  const sampleCodes = [...byCode.keys()].slice(0, 10);
  console.log(`[pdfTextExtractor] Sample product codes in lookup: ${sampleCodes.join(", ")}`);

  for (const row of rows) {
    const rowText = row.map((i) => i.text).join(" ");
    const rowTextLower = rowText.toLowerCase();

    // Skip very short rows (likely headers, page numbers, etc.)
    if (rowText.length < 3) {
      skippedShort++;
      continue;
    }

    // REQUIRE PRICE — skip all rows that have no R-prefixed price
    if (!hasAnyPrice(rowText)) {
      failedRows++;
      continue;
    }

    // Try to match by product code first (most reliable)
    let matched: PaletteProduct | null = null;
    let matchedCode = "";

    for (const [code, product] of byCode) {
      if (code.length >= 3 && rowTextLower.includes(code)) {
        matched = product;
        matchedCode = product.product_code;
        break;
      }
    }

    // Fall back to short_name matching if no code match
    if (!matched) {
      for (const [name, product] of byName) {
        if (name.length >= 5 && rowTextLower.includes(name)) {
          matched = product;
          matchedCode = product.product_code;
          break;
        }
      }
    }

    // Fall back to description matching for consumable-type suppliers
    if (!matched && isRelaxedCatalog) {
      for (const [desc, product] of byDescription) {
        if (desc.length >= 8 && rowTextLower.includes(desc)) {
          matched = product;
          matchedCode = product.product_code;
          break;
        }
      }
    }

    // Detect price in the row text
    const detectedPrice = detectPrice(rowText);
    const hasPrice = detectedPrice !== null;

    // For unmatched rows only, require the row to pass product-row validation
    // Matched rows are ALWAYS included regardless of isProductRow
    if (!matched && !isProductRow(rowText, isRelaxedCatalog)) {
      failedRows++;
      continue;
    }

    passedRows++;

    // Ghost row check (needs percentage coords, so compute early)
    const _minX = Math.min(...row.map((i) => i.x));
    const _minY = Math.min(...row.map(i => i.y));
    const _y_pct = (_minY / pageHeight) * 100;
    const hasCodePattern = /\b[A-Z]{2,}\d+[A-Z0-9]*\b/i.test(rowText);
    if (isGhostRow(rowText, _y_pct, hasPrice, hasCodePattern)) {
      failedRows++;
      continue;
    }

    // Calculate tight bounding box based on font metrics
    const rowYs = row.map(i => i.y);
    const rowHeights = row.map(i => i.height);
    const minY = Math.min(...rowYs);
    const maxItemHeight = Math.max(...rowHeights);
    const tightMaxY = minY + maxItemHeight;

    // Find the rightmost price item to position the icon at the price column
    const priceRegex = /R\s*[\d\s,]+(?:[.,]\d{1,2})?/;
    let rightmostPriceRightEdge = -1;
    for (const item of row) {
      if (priceRegex.test(item.text)) {
        const rightEdge = item.x + item.width;
        if (rightEdge > rightmostPriceRightEdge) {
          rightmostPriceRightEdge = rightEdge;
        }
      }
    }

    // If no price item found among individual items, fallback to max X of row
    const maxX = Math.max(...row.map((i) => i.x + i.width));
    const iconX = rightmostPriceRightEdge > 0 ? rightmostPriceRightEdge : maxX;

    // Convert to percentage coordinates — icon positioned at right edge of price
    const x_pct = (iconX / pageWidth) * 100;
    const y_pct = (minY / pageHeight) * 100;
    const w_pct = 4; // narrow, just for the icon
    const h_pct = ((tightMaxY - minY) / pageHeight) * 100;

    // Skip regions that are too narrow or positioned outside page
    if (w_pct < 1 || h_pct < 0.2) continue;
    if (x_pct < 0 || y_pct < 0 || x_pct > 100 || y_pct > 100) continue;

    // ISSUE 3 FIX: Skip regions with empty labels or oversized height (>5% of page)
    const trimmedLabel = rowText.trim();
    if (!trimmedLabel || trimmedLabel.length < 2) continue;
    if (h_pct > 5) continue;

    // Extract product_code from the row text for dedup
    // Use longer text + price to avoid false dedup of similar rows (e.g. insulation sizes)
    const extractedCode = matchedCode || (() => {
      const codeMatch = rowText.match(/\b([A-Z]{2,}\d+[A-Z0-9]*)\b/);
      if (codeMatch) return codeMatch[1];
      // Include price in key to differentiate rows with similar descriptions but different prices
      const priceTag = detectedPrice ? `@${detectedPrice}` : "";
      return trimmedLabel.substring(0, 80) + priceTag;
    })();

    regions.push({
      product: matched,
      product_code: extractedCode,
      label: trimmedLabel.substring(0, 200),
      x_pct: Math.max(0, x_pct),
      y_pct: Math.max(0, y_pct),
      w_pct: Math.min(100 - x_pct, w_pct),
      h_pct: Math.min(100 - y_pct, h_pct),
      matched: !!matched,
      has_price: hasPrice,
      detected_price: detectedPrice,
    });
  }

  // Deduplicate regions by product_code — keep first occurrence
  const seenCodes = new Set<string>();
  const deduped: ExtractedProductRegion[] = [];
  for (const r of regions) {
    const key = r.product_code.toLowerCase().trim();
    // Only dedup short product codes (real SKUs), not long description-based keys
    if (key.length >= 3 && key.length < 40 && seenCodes.has(key)) {
      continue; // skip duplicate
    }
    if (key.length >= 3 && key.length < 40) seenCodes.add(key);
    deduped.push(r);
  }

  // Second dedup pass: group by rounded y_pct, keep only the rightmost icon per row
  const yBuckets = new Map<number, number>(); // bucket → index of rightmost
  const finalDeduped: ExtractedProductRegion[] = [];
  for (let i = 0; i < deduped.length; i++) {
    const bucket = Math.round(deduped[i].y_pct / 1.5) * 1.5;
    const existing = yBuckets.get(bucket);
    if (existing !== undefined) {
      // Keep the one with highest x_pct (rightmost)
      if (deduped[i].x_pct > finalDeduped[existing].x_pct) {
        finalDeduped[existing] = deduped[i];
      }
    } else {
      yBuckets.set(bucket, finalDeduped.length);
      finalDeduped.push(deduped[i]);
    }
  }

  const matchedCount = finalDeduped.filter(r => r.matched).length;
  const unmatchedCount = finalDeduped.filter(r => !r.matched).length;
  const unmatchedWithPrice = finalDeduped.filter(r => !r.matched && r.has_price);
  console.log(`[pdfTextExtractor] Results: ${finalDeduped.length} regions (${matchedCount} matched, ${unmatchedCount} unmatched, ${unmatchedWithPrice.length} unmatched with price), ${regions.length - finalDeduped.length} duplicates removed, ${passedRows} rows passed filter, ${failedRows} rows failed, ${skippedShort} too short`);
  const sampleUnmatched = unmatchedWithPrice.slice(0, 5);
  for (const u of sampleUnmatched) {
    console.log(`[pdfTextExtractor] UNMATCHED: code="${u.product_code}" price=${u.detected_price} label="${u.label.substring(0, 80)}"`);
  }

  return finalDeduped;
}

// Cache for extracted regions per page — versioned to bust on logic changes
let _extractionVersion = 13; // v13: require price, rightmost-price icon position, y-dedup
const extractionCache = new Map<
  string,
  ExtractedProductRegion[]
>();

/**
 * Extract and match products from a PDF page, with caching.
 * Returns cached results if available for the same page + product set.
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
