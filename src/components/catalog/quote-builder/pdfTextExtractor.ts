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
 */
function groupTextItemsIntoRows(
  items: ExtractedTextItem[],
  threshold = 6
): ExtractedTextItem[][] {
  if (items.length === 0) return [];

  const sorted = [...items].sort((a, b) => a.y - b.y);
  const rows: ExtractedTextItem[][] = [];
  let currentRow: ExtractedTextItem[] = [sorted[0]];
  let currentY = sorted[0].y;

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].y - currentY > threshold) {
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
 * Matches: R1,024.07, R 500.00, R12345, or standalone decimal numbers >= 100
 */
function detectPrice(text: string): number | null {
  // Only match explicit Rand prices: R followed by digits with optional commas and mandatory 2 decimal places
  const rPriceMatch = text.match(/R\s?(\d{1,3}(?:[,]\d{3})*\.\d{2})/);
  if (rPriceMatch) {
    const val = parseFloat(rPriceMatch[1].replace(/,/g, ""));
    if (!isNaN(val) && val >= 10) return val;
  }
  return null;
}

/** Count how many R-prefixed price values appear in text */
function countPrices(text: string): number {
  const matches = text.match(/R\s?\d{1,3}(?:[,]\d{3})*\.\d{2}/g);
  return matches ? matches.length : 0;
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

/**
 * Check if a text row looks like a real product line item (not a description).
 * Two modes:
 *   - Strict (HVAC): requires model code + 2 prices
 *   - Relaxed (consumable): requires at least 1 price + short enough to be tabular
 */
function isProductRow(text: string, relaxed = false): boolean {
  const trimmed = text.trim();

  // Exclude bullet points and dashes
  if (trimmed.startsWith("•") || trimmed.startsWith("-") || trimmed.startsWith("–")) return false;

  // Exclude long prose (product rows are typically short tabular data)
  if (trimmed.length > (relaxed ? 200 : 120)) return false;

  // Exclude lines with common description phrases
  const lower = trimmed.toLowerCase();
  if (DESCRIPTION_PHRASES.some(phrase => lower.includes(phrase))) return false;

  const priceCount = countPrices(trimmed);

  if (relaxed) {
    // For consumable suppliers: just need at least 1 price and reasonable length
    return priceCount >= 1;
  }

  // Strict mode: require a strict HVAC-style model code + 2 prices
  const modelCodeRegex = /\b[A-Z]{2,5}[A-Z0-9]{2,}\d{1,3}[A-Z0-9]*\b/;
  if (!modelCodeRegex.test(trimmed)) return false;
  if (priceCount < 2) return false;

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

  // Determine if this looks like an HVAC catalog or a consumable catalog
  // by checking if the majority of products have HVAC-style model codes
  const hvacCodeRegex = /^[A-Z]{2,5}[A-Z0-9]{2,}\d{1,3}[A-Z0-9]*$/;
  const hvacCount = products.filter(p => hvacCodeRegex.test(p.product_code || "")).length;
  const isRelaxedCatalog = hvacCount < products.length * 0.5; // Less than 50% HVAC codes = relaxed mode

  for (const row of rows) {
    const rowText = row.map((i) => i.text).join(" ");
    const rowTextLower = rowText.toLowerCase();

    // Skip very short rows (likely headers, page numbers, etc.)
    if (rowText.length < 3) continue;

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
        // Only match if a significant portion of the description appears in the row
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

    // For unmatched rows, require the row to pass product-row validation
    if (!matched && !isProductRow(rowText, isRelaxedCatalog)) continue;

    // Calculate bounding box for the entire row
    const minX = Math.min(...row.map((i) => i.x));
    const maxX = Math.max(...row.map((i) => i.x + i.width));
    const minY = Math.min(...row.map((i) => i.y));
    const maxY = Math.max(...row.map((i) => i.y + i.height));

    // Convert to percentage coordinates
    const x_pct = (minX / pageWidth) * 100;
    const y_pct = (minY / pageHeight) * 100;
    const w_pct = ((maxX - minX) / pageWidth) * 100;
    const h_pct = ((maxY - minY) / pageHeight) * 100;

    // Skip regions that are too narrow or positioned outside page
    if (w_pct < 1 || h_pct < 0.3) continue;
    if (x_pct < 0 || y_pct < 0 || x_pct > 100 || y_pct > 100) continue;

    regions.push({
      product: matched,
      product_code: matchedCode || rowText.substring(0, 30),
      label: rowText.substring(0, 200),
      x_pct: Math.max(0, x_pct),
      y_pct: Math.max(0, y_pct),
      w_pct: Math.min(100 - x_pct, w_pct),
      h_pct: Math.min(100 - y_pct, h_pct),
      matched: !!matched,
      has_price: hasPrice,
      detected_price: detectedPrice,
    });
  }

  return regions;
}

// Cache for extracted regions per page — versioned to bust on logic changes
let _extractionVersion = 0;
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
