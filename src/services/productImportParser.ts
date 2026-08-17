/**
 * SIMPLIFIED PRODUCT IMPORT PARSER
 * 
 * Simple model: PDF price → strip VAT if needed → apply trade discount → cost_price
 * selling_price is a DB generated column, never set in code.
 */

import { VAT_RATE, stripVat, applyDiscount, addVat } from "@/lib/pricing";
import { supabase } from "@/integrations/supabase/client";
import { renderPDFToImages } from "@/utils/pdfEnhancer";

/** Strip non-numeric chars from AI values like "9000 BTU" → 9000 */
function sanitizeInt(val: any): number | null {
  if (val == null) return null;
  if (typeof val === "number") return isNaN(val) ? null : Math.round(val);
  const n = parseInt(String(val).replace(/[^0-9\-]/g, ""), 10);
  return isNaN(n) ? null : n;
}
function sanitizeFloat(val: any): number | null {
  if (val == null) return null;
  if (typeof val === "number") return isNaN(val) ? null : val;
  const n = parseFloat(String(val).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? null : n;
}

// ─── TYPES ───

export interface SupplierPricingSettings {
  supplierName: string;
  tradeDiscount: number;
  markupPercent: number;
  pricesIncludeVat: boolean;
}

/** @deprecated kept for backward compat */
export type PriceListType = "cost_price" | "list_price_with_discount";

export interface ParsedProduct {
  model_number: string;
  description: string;
  category: string;
  /** The raw price as it appears in the PDF/CSV */
  raw_price: number;
  /** Our buy price excl VAT, after trade discount */
  cost_price: number;
  /** cost_price × (1 + markup/100) — excl VAT */
  selling_price: number;
  /** selling_price × 1.15 */
  selling_price_incl_vat: number;
  /** Default markup applied */
  default_markup_percent: number;
  confidence: "high" | "medium" | "low";
  flags: string[];
  // Technical specs
  btu_rating?: number | null;
  pipe_size?: string | null;
  refrigerant_type?: string | null;
  phase?: string | null;
  speed_type?: string | null;
  kw?: number | null;
  unit_type?: string | null;
  short_name?: string | null;
  brand?: string | null;
  product_category?: string | null;
  sold_in_length?: boolean;
  unit_length?: number | null;
  price_per_metre?: number | null;
  // Bounding box fields (from AI extraction, normalized 0-1)
  row_bbox?: { x: number; y: number; width: number; height: number } | null;
  price_bbox?: { x: number; y: number; width: number; height: number } | null;
  page_number?: number | null;
  // Legacy fields (kept for ImportPreviewModal display compat)
  price_excl_vat?: number;
  price_includes_vat?: boolean;
  price_list_type?: string;
  supplier_discount_percent?: number;
  markup_percent?: number;
  calculated_price?: number;
  vat_amount?: number;
  sell_price_incl_vat?: number;
}

export interface ImportPreview {
  products: ParsedProduct[];
  detectedPriceType: "excl_vat" | "incl_vat" | "unknown";
  detectedDiscount: number;
  suggestedMarkup: number;
  totalProducts: number;
  warnings: string[];
  columnMap?: Record<string, string>;
  vatEvidence: string;
  discountEvidence: string;
  vatConfidence: "high" | "medium" | "low";
  discountConfidence: "high" | "medium" | "low";
  supplierSettings: SupplierPricingSettings;
  parseMethod?: "ai" | "regex" | "csv" | "grok_ai" | "lovable_ai";
  /** Price columns detected by Grok AI */
  detectedPriceColumns?: string[];
  /** The column Grok auto-selected as best */
  selectedPriceColumn?: string;
}

export type ImportStage =
  | { stage: "loading_pdf"; detail: string }
  | { stage: "rendering_pages"; done: number; total: number }
  | { stage: "enhancing_images"; done: number; total: number }
  | { stage: "ai_extraction"; detail: string }
  | { stage: "text_fallback"; detail: string }
  | { stage: "complete"; detail: string };

// ─── FETCH SUPPLIER SETTINGS ───

export async function getSupplierPricingSettings(supplierId: string): Promise<SupplierPricingSettings> {
  const { data: supplier } = await (supabase.from("suppliers") as any)
    .select("name, default_trade_discount, default_markup_percent, price_includes_vat")
    .eq("id", supplierId)
    .single();

  return {
    supplierName: supplier?.name || "",
    tradeDiscount: supplier?.default_trade_discount ?? 0,
    markupPercent: supplier?.default_markup_percent ?? 20,
    pricesIncludeVat: supplier?.price_includes_vat ?? false,
  };
}

// ─── SIMPLE PRICE CALCULATION ───

const r2 = (n: number) => Math.round(n * 100) / 100;

export function calculateImportPrices(
  rawPrice: number,
  pricesIncludeVat: boolean,
  tradeDiscountPercent: number,
  markupPercent: number
) {
  // Step 1: Strip VAT if prices include it
  const priceExclVat = pricesIncludeVat ? stripVat(rawPrice) : rawPrice;
  
  // Step 2: Apply trade discount to get cost_price
  const cost_price = tradeDiscountPercent > 0
    ? applyDiscount(priceExclVat, tradeDiscountPercent)
    : priceExclVat;
  
  // Step 3: Calculate selling price (excl VAT)
  const selling_price = r2(cost_price * (1 + markupPercent / 100));
  const selling_price_incl_vat = addVat(selling_price);

  return {
    price_excl_vat: r2(priceExclVat),
    cost_price: r2(cost_price),
    selling_price,
    selling_price_incl_vat,
  };
}

export function recalculateProducts(
  products: ParsedProduct[],
  _priceListType: PriceListType,
  isInclVat: boolean,
  discountPercent: number,
  markupPercent: number
): ParsedProduct[] {
  return products.map((p) => {
    const calc = calculateImportPrices(p.raw_price, isInclVat, discountPercent, markupPercent);
    const flags: string[] = [];
    if (isInclVat) flags.push("price_incl_vat_stripped");
    if (discountPercent > 0) flags.push(`discount_${discountPercent}pct_applied`);
    return {
      ...p,
      cost_price: calc.cost_price,
      selling_price: calc.selling_price,
      selling_price_incl_vat: calc.selling_price_incl_vat,
      default_markup_percent: markupPercent,
      flags,
      // Legacy compat fields
      price_excl_vat: calc.price_excl_vat,
      price_includes_vat: isInclVat,
      supplier_discount_percent: discountPercent,
      markup_percent: markupPercent,
      calculated_price: calc.selling_price,
      vat_amount: r2(calc.selling_price * VAT_RATE),
      sell_price_incl_vat: calc.selling_price_incl_vat,
    };
  });
}

// ─── MAIN ENTRY POINT ───

export async function parseImportFile(
  file: File,
  supplierId: string,
  settingsOverride?: Partial<SupplierPricingSettings>,
  onStage?: (stage: ImportStage) => void
): Promise<ImportPreview> {
  const dbSettings = await getSupplierPricingSettings(supplierId);
  const settings: SupplierPricingSettings = { ...dbSettings, ...settingsOverride };

  if (file.name.endsWith(".csv") || file.type === "text/csv") {
    return parseCSVFile(file, settings, supplierId);
  }
  return parsePDFWithFullPipeline(file, settings, supplierId, onStage);
}

// ─── VAT DETECTION ───

function detectVATInclusion(
  text: string,
  headers: string[]
): { isIncl: boolean; confidence: "high" | "medium" | "low"; evidence: string } {
  const upperText = text.toUpperCase();
  const upperHeaders = headers.map((h) => h.toUpperCase()).join(" ");

  if (/LIST\s*PRICE\s*EXCL\.?\s*VAT|PRICE\s*EX\s*VAT|EXCL\.?\s*VAT/.test(upperHeaders))
    return { isIncl: false, confidence: "high", evidence: "Column header says EXCL VAT" };
  if (/LIST\s*PRICE\s*INCL\.?\s*VAT|PRICE\s*INC\.?\s*VAT|INCL\.?\s*VAT/.test(upperHeaders))
    return { isIncl: true, confidence: "high", evidence: "Column header says INCL VAT" };
  if (/ALL\s*PRICES\s*(?:ARE\s*)?EXCL(?:UDING)?\.?\s*VAT/.test(upperText))
    return { isIncl: false, confidence: "high", evidence: 'Document states "All prices excl VAT"' };
  if (/ALL\s*PRICES\s*(?:ARE\s*)?INCL(?:UDING)?\.?\s*VAT/.test(upperText))
    return { isIncl: true, confidence: "high", evidence: 'Document states "All prices incl VAT"' };
  if (/\bVAT\b/.test(upperHeaders) && !/INCL/.test(upperHeaders))
    return { isIncl: false, confidence: "medium", evidence: "Separate VAT column detected" };
  if (/\bRRP\b|RECOMMENDED\s*RETAIL/.test(upperText))
    return { isIncl: true, confidence: "medium", evidence: "RRP detected — typically incl VAT in SA" };
  return { isIncl: false, confidence: "low", evidence: "Could not determine — defaulting to excl VAT" };
}

function detectDiscount(
  text: string
): { percent: number; confidence: "high" | "medium" | "low"; evidence: string } {
  const upperText = text.toUpperCase();
  const discountMatch = upperText.match(/(?:TRADE\s*)?DISCOUNT[:\s]+(\d{1,2}(?:\.\d+)?)\s*%/);
  if (discountMatch) return { percent: parseFloat(discountMatch[1]), confidence: "high", evidence: `Discount: ${discountMatch[1]}%` };
  const lessMatch = upperText.match(/LESS\s+(\d{1,2}(?:\.\d+)?)\s*%/);
  if (lessMatch) return { percent: parseFloat(lessMatch[1]), confidence: "high", evidence: `"Less ${lessMatch[1]}%"` };
  if (/DEALER|RESELLER|NET\s*PRICE/.test(upperText))
    return { percent: 0, confidence: "medium", evidence: "Dealer/net price — discount pre-applied" };
  return { percent: 0, confidence: "low", evidence: "No discount detected" };
}

// ─── PDF PIPELINE ───

const CHUNK_SIZE = 6000;

/** Parse SA price formats: spaces as thousand separators, comma decimals */
function parsePrice(priceStr: string): number {
  if (!priceStr) return 0;
  priceStr = priceStr.replace(/[^\d., ]/g, '').trim();
  priceStr = priceStr.replace(/\s/g, '');
  const commaIndex = priceStr.lastIndexOf(',');
  if (commaIndex > -1 && priceStr.length - commaIndex - 1 === 2) {
    priceStr = priceStr.replace(/,/g, '.');
  } else {
    priceStr = priceStr.replace(/,/g, '');
  }
  return parseFloat(priceStr) || 0;
}

async function parsePDFWithFullPipeline(
  file: File,
  settings: SupplierPricingSettings,
  supplierId: string,
  onStage?: (stage: ImportStage) => void
): Promise<ImportPreview> {
  let parseMethod: ImportPreview["parseMethod"] = "regex";
  let detectedPriceColumns: string[] = [];
  let selectedPriceColumn: string | undefined;
  let grokDetectedInclVat = false;
  let rawRows: Array<{
    model: string; description: string; price: number; category: string;
    btu_rating?: number | null; pipe_size?: string | null; refrigerant_type?: string | null;
    phase?: string | null; speed_type?: string | null; kw?: number | null;
    unit_type?: string | null; short_name?: string | null; brand?: string | null;
    product_category?: string | null; sold_in_length?: boolean; unit_length?: number | null;
    price_per_metre?: number | null;
    row_bbox?: { x: number; y: number; width: number; height: number } | null;
    price_bbox?: { x: number; y: number; width: number; height: number } | null;
    page_number?: number | null;
  }> = [];

  // STAGE 1: Render PDF
  onStage?.({ stage: "loading_pdf", detail: `Loading ${file.name}...` });
  const { images, numPages, allText } = await renderPDFToImages(file, 2.0, (done, total) => {
    onStage?.({ stage: "rendering_pages", done, total });
  });
  console.log(`[Import] PDF: ${numPages} pages, ${allText.length} chars`);

  // STAGE 2: Enhancement skipped
  console.log(`[Import] Skipping Deep-Image.ai enhancement`);

  // STAGE 3: Grok AI
  onStage?.({ stage: "ai_extraction", detail: "Parsing with Grok AI..." });
  try {
    const chunks: string[] = [];
    let i = 0;
    while (i < allText.length) {
      let end = Math.min(i + CHUNK_SIZE, allText.length);
      if (end < allText.length) {
        const lastNewline = allText.lastIndexOf("\n", end);
        if (lastNewline > i + CHUNK_SIZE * 0.5) end = lastNewline + 1;
      }
      chunks.push(allText.substring(i, end));
      i = end;
    }

    // Fetch supplier_type so edge function gets correct consumables prompt
    let supplierType: string | null = null;
    try {
      const { data: supRow } = await (supabase.from("suppliers") as any)
        .select("supplier_type")
        .eq("id", supplierId)
        .single();
      supplierType = supRow?.supplier_type || null;
    } catch { /* ignore */ }

    for (let ci = 0; ci < chunks.length; ci++) {
      onStage?.({ stage: "ai_extraction", detail: `Grok AI: chunk ${ci + 1}/${chunks.length} (${chunks[ci].length} chars)...` });
      console.log(`[Import] Sending chunk ${ci + 1}/${chunks.length}: ${chunks[ci].length} chars, first 200: "${chunks[ci].substring(0, 200).replace(/\n/g, '\\n')}"`);
      const { data, error } = await supabase.functions.invoke("parse-pdf-with-grok", {
        body: { extracted_text: chunks[ci], supplier_id: supplierId, supplier_name: settings.supplierName, supplier_type: supplierType === "consumables" || supplierType === "both" ? "consumables" : undefined, chunk_index: ci, chunk_total: chunks.length },
      });
      if (error) { console.error(`[Import] Grok chunk ${ci} error:`, error.message || error, 'data:', JSON.stringify(data)?.substring(0, 200)); continue; }

      const chunkProducts = data?.products || [];
      let chunkAccepted = 0;

      // Capture detected price columns from Grok (filter out raw R-amounts)
      if (data?.detected_price_columns?.length) {
        for (const col of data.detected_price_columns) {
          const t = (col || "").trim();
          if (!t) continue;
          // Exclude pure price strings
          if (/^(R\s*)?[\d\s,]+(\.\s?\d{1,2})?$/i.test(t)) continue;
          // Must contain a header keyword
          if (!/\b(PRICE|VAT|LIST|EXCL|INCL|INC|NETT|WEBSHOP|CAMPAIGN|RRP|COST|RETAIL|TRADE|DEALER)\b/i.test(t)) continue;
          if (!detectedPriceColumns.includes(col)) detectedPriceColumns.push(col);
        }
      }

      for (const p of chunkProducts) {
        // Use the smart-selected cost_price from Grok (already picked best column)
        const price = typeof p.cost_price === "number" && p.cost_price > 0
          ? p.cost_price
          : 0;

        // Track selected column and VAT detection from first product
        if (!selectedPriceColumn && p.selected_price_column) {
          selectedPriceColumn = p.selected_price_column;
          grokDetectedInclVat = !!p.price_is_incl_vat;
          console.log(`[Import] Grok selected column: "${selectedPriceColumn}", isInclVat: ${grokDetectedInclVat}`);
        }

        if (price > 0) {
          rawRows.push({
            model: p.product_code || p.sku || "",
            description: p.description || p.name || "",
            price,
            category: p.product_category || p.category || "Air Conditioning",
            btu_rating: p.btu_rating || null, pipe_size: p.pipe_size || null,
            refrigerant_type: p.refrigerant_type || null, phase: p.phase || null,
            speed_type: p.speed_type || null, kw: p.kw || null, unit_type: p.unit_type || null,
            short_name: p.short_name || null, brand: p.brand || null,
            product_category: p.product_category || null,
            sold_in_length: p.sold_in_length || false, unit_length: p.unit_length || null,
            price_per_metre: p.price_per_metre || null,
            // AI bounding box data for visual overlay fallback on scanned pages
            row_bbox: p.rowBbox || p.row_bbox || null,
            price_bbox: p.priceBbox || p.price_bbox || null,
            page_number: p.pageNumber || p.page_number || null,
          });
          chunkAccepted++;
        } else {
          console.warn(`[Import] Chunk ${ci}: Skipped product "${p.product_code || p.sku}" — price=${price} (cost_price=${p.cost_price})`);
        }
      }
      console.log(`[Import] Chunk ${ci + 1}/${chunks.length}: ${chunkProducts.length} from Grok, ${chunkAccepted} accepted into rawRows (${chunkProducts.length - chunkAccepted} skipped for price<=0)`);
    }
    if (rawRows.length > 0) { parseMethod = "grok_ai"; console.log(`[Import] Grok total: ${rawRows.length} products across ${chunks.length} chunks`); }
  } catch (err) { console.warn("[Import] Grok failed:", err); }

  // STAGE 4: Lovable AI fallback
  if (rawRows.length === 0 && allText.trim().length > 50) {
    onStage?.({ stage: "ai_extraction", detail: "Trying Lovable AI..." });
    try {
      const { data, error } = await supabase.functions.invoke("parse-price-list", {
        body: { csv_text: allText.substring(0, 15000), supplier_id: supplierId, supplier_name: settings.supplierName },
      });
      if (!error) {
        for (const p of (data?.products || (Array.isArray(data) ? data : []))) {
          if ((p.cost_price || 0) > 0) {
            rawRows.push({ model: p.product_code || "", description: p.description || "", price: p.cost_price, category: p.category || "Air Conditioning" });
          }
        }
        if (rawRows.length > 0) { parseMethod = "lovable_ai"; }
      }
    } catch (err) { console.warn("[Import] Lovable AI failed:", err); }
  }

  // STAGE 5: Regex fallback
  if (rawRows.length === 0) {
    onStage?.({ stage: "text_fallback", detail: "Using text extraction fallback..." });
    const pricePattern = /([A-Z0-9][A-Z0-9\-\/]{4,29})\s+([A-Za-z0-9\s\-\/,\.]{10,80}?)\s+R?\s*([\d\s,]+\.?\d{0,2})/g;
    let match;
    while ((match = pricePattern.exec(allText)) !== null) {
      const price = parsePrice(match[3]);
      if (price < 50) continue;
      if (price > 0 && price < 1_000_000) {
        rawRows.push({ model: match[1].trim(), description: match[2].trim(), price, category: detectCategory(match[2]) });
      }
    }
    parseMethod = "regex";
  }

  onStage?.({ stage: "complete", detail: `${rawRows.length} products found` });

  // Detection
  const vatDetection = detectVATInclusion(allText, [allText.substring(0, 500)]);
  const discountDetection = detectDiscount(allText);
  const warnings: string[] = [];

  // PDF supplier price lists are always EXCL VAT — confirmed policy, no exceptions.
  // Keep vatDetection/grokDetectedInclVat computed above only to surface a warning if a
  // list looks like it might say otherwise, but never let them flip pricing behavior.
  const effectiveInclVat = false;
  const effectiveDiscount = discountDetection.confidence === "high" ? discountDetection.percent : settings.tradeDiscount;

  if (grokDetectedInclVat || (vatDetection.confidence === "high" && vatDetection.isIncl)) {
    warnings.push("⚠️ This list looked like it might say INCL VAT, but PDF price lists are treated as EXCL VAT — please verify manually if unsure");
  }
  if (parseMethod === "regex") warnings.push("📝 Text extraction — results may be less accurate");
  if (detectedPriceColumns.length > 1) {
    warnings.push(`📊 Multiple price columns detected: ${detectedPriceColumns.join(", ")}. Using "${selectedPriceColumn || detectedPriceColumns[0]}".`);
  }

  // Filter out section header rows (e.g. "AR3000 Non-Inverter" with no full model suffix)
  const sectionHeaderPattern = /^AR\d{3,4}$/i; // e.g. AR3000, AR5000 — no full model suffix
  const filteredRows = rawRows.filter((r) => {
    const code = (r.model || "").trim();
    // Skip rows with no model code
    if (!code) return false;
    // Skip section headers: short codes like "AR3000" without full suffix
    if (sectionHeaderPattern.test(code)) {
      console.log(`[Import] Skipping section header row: "${code}" — "${r.description}"`);
      return false;
    }
    return true;
  });
  console.log(`[Import] After section header filter: ${filteredRows.length}/${rawRows.length} rows (${rawRows.length - filteredRows.length} removed)`);

  // Deduplicate — use model+description+price to keep accessories in different sections
  const seen = new Set<string>();
  const uniqueRows = filteredRows.filter((r) => {
    const key = r.model.toLowerCase() + '|' + r.description.toLowerCase().substring(0, 50) + '|' + r.price;
    if (!key || seen.has(key)) {
      console.log(`[Import] Dedup: removing "${r.model}" @ R${r.price} — "${r.description.substring(0, 40)}"`);
      return false;
    }
    seen.add(key);
    return true;
  });
  console.log(`[Import] After dedup: ${uniqueRows.length}/${filteredRows.length} rows (${filteredRows.length - uniqueRows.length} duplicates removed)`);

  const products: ParsedProduct[] = uniqueRows.map((row) => {
    const calc = calculateImportPrices(row.price, effectiveInclVat, effectiveDiscount, settings.markupPercent);
    const flags: string[] = [];
    if (effectiveInclVat) flags.push("price_incl_vat_stripped");
    if (effectiveDiscount > 0) flags.push(`discount_${effectiveDiscount}pct_applied`);

    const specs = extractSpecsFromText(row.model, row.description);

    return {
      model_number: row.model,
      description: row.description,
      category: row.category,
      raw_price: row.price,
      cost_price: calc.cost_price,
      selling_price: calc.selling_price,
      selling_price_incl_vat: calc.selling_price_incl_vat,
      default_markup_percent: settings.markupPercent,
      confidence: (["grok_ai", "ai", "lovable_ai"] as string[]).includes(parseMethod || "") ? "high" : vatDetection.confidence,
      flags,
      // Legacy compat
      price_excl_vat: calc.price_excl_vat,
      price_includes_vat: effectiveInclVat,
      price_list_type: effectiveDiscount > 0 ? "list_price_with_discount" : "cost_price",
      supplier_discount_percent: effectiveDiscount,
      markup_percent: settings.markupPercent,
      calculated_price: calc.selling_price,
      vat_amount: r2(calc.selling_price * VAT_RATE),
      sell_price_incl_vat: calc.selling_price_incl_vat,
      // Specs
      btu_rating: sanitizeInt(row.btu_rating || specs.btu_rating),
      pipe_size: row.pipe_size || specs.pipe_size || null,
      refrigerant_type: row.refrigerant_type || specs.refrigerant_type || null,
      phase: row.phase || specs.phase || null,
      speed_type: row.speed_type || specs.speed_type || null,
      kw: sanitizeFloat(row.kw || specs.kw),
      unit_type: row.unit_type || specs.unit_type || null,
      short_name: row.short_name || null,
      brand: row.brand || null,
      product_category: row.product_category || row.category || null,
      sold_in_length: row.sold_in_length || false,
      unit_length: row.unit_length || null,
      price_per_metre: row.price_per_metre || null,
      // AI bounding boxes for visual overlay on scanned pages
      row_bbox: row.row_bbox || null,
      price_bbox: row.price_bbox || null,
      page_number: row.page_number || null,
    };
  });

  return {
    products,
    detectedPriceType: effectiveInclVat ? "incl_vat" : "excl_vat",
    detectedDiscount: effectiveDiscount,
    suggestedMarkup: settings.markupPercent,
    totalProducts: products.length,
    warnings,
    vatEvidence: grokDetectedInclVat ? "AI selected INCL VAT column" : vatDetection.evidence,
    discountEvidence: effectiveDiscount > 0 ? discountDetection.evidence : "N/A — no discount",
    vatConfidence: grokDetectedInclVat ? "high" : vatDetection.confidence,
    discountConfidence: effectiveDiscount > 0 ? discountDetection.confidence : "high",
    supplierSettings: settings,
    parseMethod,
    detectedPriceColumns: detectedPriceColumns.length > 0 ? detectedPriceColumns : undefined,
    selectedPriceColumn,
  };
}

// ─── HELPERS ───

function detectCategory(description: string): string {
  const d = description.toUpperCase();
  if (/SPLIT|WALL\s*MOUNT|CASSETTE|DUCTED|FLOOR|CEILING/.test(d)) return "Air Conditioning";
  if (/HEAT\s*PUMP|WATER\s*HEAT|GEYSER/.test(d)) return "Water Heaters";
  if (/INVERTER|BATTERY|SOLAR/.test(d)) return "Inverters";
  if (/COPPER|PIPE|FLARE|ELBOW|FITTING|TAPE|CABLE|BRACKET/.test(d)) return "Consumables";
  return "Air Conditioning";
}

function extractSpecsFromText(model: string, description: string) {
  const text = `${model} ${description}`.toUpperCase();

  let btu_rating: number | null = null;
  const btuMatch = text.match(/(\d{1,3})[,.]?(\d{3})\s*BTU/);
  if (btuMatch) btu_rating = parseInt(btuMatch[1] + btuMatch[2]);
  const btuKMatch = text.match(/(\d{1,3})K\s*BTU/);
  if (!btu_rating && btuKMatch) btu_rating = parseInt(btuKMatch[1]) * 1000;

  let kw: number | null = null;
  const kwMatch = text.match(/(\d+\.?\d*)\s*KW/);
  if (kwMatch) kw = parseFloat(kwMatch[1]);

  if (!btu_rating && kw) btu_rating = Math.round(kw * 3412);
  if (!kw && btu_rating) kw = parseFloat((btu_rating / 3412).toFixed(1));

  if (!btu_rating) {
    const arMatch = model.toUpperCase().match(/AR(\d{2})/);
    if (arMatch) {
      const num = parseInt(arMatch[1]);
      const btuMap: Record<number, number> = { 9: 9000, 12: 12000, 18: 18000, 24: 24000, 28: 28000, 36: 36000 };
      if (btuMap[num]) { btu_rating = btuMap[num]; kw = parseFloat((btu_rating / 3412).toFixed(1)); }
    }
  }

  let pipe_size: string | null = null;
  const pipeMatch = text.match(/(1\/[24]|3\/8|1\/2|5\/8|3\/4)\s*[X×&]\s*(1\/[24]|3\/8|1\/2|5\/8|3\/4)/i);
  if (pipeMatch) pipe_size = `${pipeMatch[1]} x ${pipeMatch[2]}`;
  if (!pipe_size) {
    const mmPipe = text.match(/(6\.35|9\.52|12\.7|15\.88|19\.05)\s*[X×\/]\s*(6\.35|9\.52|12\.7|15\.88|19\.05)/);
    if (mmPipe) pipe_size = `${mmPipe[1]}/${mmPipe[2]}mm`;
  }

  let phase: string | null = null;
  if (/\b3[\s-]*PH|THREE\s*PHASE|380\s*V|415\s*V/i.test(text)) phase = "Three Phase";
  else if (/\b1[\s-]*PH|SINGLE\s*PHASE|220\s*V|230\s*V/i.test(text)) phase = "Single Phase";

  let speed_type: string | null = null;
  if (/\bINV(?:ERTER)?\b|DC\s*INV|DIGITAL\s*INV/i.test(text)) speed_type = "Inverter";
  else if (/FIXED\s*SPEED|NON[\s-]*INV|FS\b/i.test(text)) speed_type = "Fixed Speed";

  let refrigerant_type: string | null = null;
  const refMatch = text.match(/\b(R410A?|R32|R22|R290|R134A?)\b/i);
  if (refMatch) refrigerant_type = refMatch[1].toUpperCase();

  let unit_type: string | null = null;
  if (/\bMIDWALL|MID\s*WALL|WALL\s*MOUNT|HI[\s-]*WALL|\bMW\b/i.test(text)) unit_type = "Midwall";
  else if (/\bCASSETTE?\b|\bCASS\b/i.test(text)) unit_type = "Cassette";
  else if (/\bDUCT(?:ED)?\b/i.test(text)) unit_type = "Ducted";
  else if (/UNDER\s*CEIL|UC\b/i.test(text)) unit_type = "Under Ceiling";
  else if (/FLOOR\s*STAND/i.test(text)) unit_type = "Floor Standing";
  else if (/\bCEILING\b/i.test(text) && !/UNDER/i.test(text)) unit_type = "Ceiling";
  else if (/\bPORT(?:ABLE)?\b/i.test(text)) unit_type = "Portable";
  else if (/MULTI[\s-]*SPLIT/i.test(text)) unit_type = "Multi Split";
  else if (/\bVRF\b|\bVRV\b/i.test(text)) unit_type = "VRF";

  return { btu_rating, kw, pipe_size, phase, speed_type, refrigerant_type, unit_type };
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') inQuotes = !inQuotes;
    else if (char === "," && !inQuotes) { result.push(current.trim()); current = ""; }
    else current += char;
  }
  result.push(current.trim());
  return result;
}

async function parseCSVFile(file: File, settings: SupplierPricingSettings, supplierId?: string): Promise<ImportPreview> {
  const text = await file.text();
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return emptyPreview("CSV file has no data rows", settings);

  const headers = parseCSVLine(lines[0]);
  const vatDetection = detectVATInclusion(text, headers);
  const discountDetection = detectDiscount(text);

  const effectiveInclVat = vatDetection.confidence === "high" ? vatDetection.isIncl : settings.pricesIncludeVat;
  const effectiveDiscount = discountDetection.confidence === "high" ? discountDetection.percent : settings.tradeDiscount;

  // Try Lovable AI first
  if (supplierId) {
    try {
      const { data, error } = await supabase.functions.invoke("parse-price-list", {
        body: { csv_text: text.substring(0, 15000), supplier_id: supplierId, supplier_name: settings.supplierName },
      });
      if (!error) {
        const aiProducts = (data?.products || (Array.isArray(data) ? data : [])).filter((p: any) => (p.cost_price || 0) > 0);
        if (aiProducts.length > 0) {
          const products: ParsedProduct[] = aiProducts.map((p: any) => {
            const calc = calculateImportPrices(p.cost_price, effectiveInclVat, effectiveDiscount, settings.markupPercent);
            return buildParsedProduct(p.product_code || "", p.description || "", p.category || "Air Conditioning", p.cost_price, calc, effectiveInclVat, effectiveDiscount, settings.markupPercent, "high");
          });
          return buildPreview(products, effectiveInclVat, effectiveDiscount, settings, vatDetection, discountDetection, [], "lovable_ai");
        }
      }
    } catch (err) { console.warn("[Import] Lovable AI CSV failed:", err); }
  }

  // Local CSV parsing
  const columnMap: Record<string, string> = {};
  for (const header of headers) {
    const h = header.toUpperCase();
    if (/MODEL|PART.?NO|SKU|CODE/.test(h) && !columnMap.model) columnMap.model = header;
    else if (/DESC|NAME|PRODUCT/.test(h) && !columnMap.description) columnMap.description = header;
    else if (/CATEGORY|TYPE|GROUP/.test(h) && !columnMap.category) columnMap.category = header;
    else if (/EXCL.*VAT|EX.*VAT/.test(h)) columnMap.price_excl = header;
    else if (/INCL.*VAT|INC.*VAT/.test(h)) columnMap.price_incl = header;
    else if (/PRICE|COST|RATE|RRP/.test(h) && !/VAT/.test(h) && !columnMap.price) columnMap.price = header;
  }

  const products: ParsedProduct[] = [];
  let autoCounter = 0;
  const warnings: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => (row[h] = values[idx] || ""));

    const priceCol = columnMap.price_excl || columnMap.price || columnMap.price_incl;
    if (!priceCol || !row[priceCol]) continue;

    const rawPrice = parseFloat(row[priceCol]?.replace(/[R,\s]/g, "") || "0");
    if (!rawPrice || rawPrice <= 0) continue;

    const isInclVat = columnMap.price_incl ? priceCol === columnMap.price_incl : effectiveInclVat;
    const calc = calculateImportPrices(rawPrice, isInclVat, effectiveDiscount, settings.markupPercent);
    const flags: string[] = [];
    if (isInclVat) flags.push("price_incl_vat_stripped");

    let modelNumber = row[columnMap.model] || "";
    if (!modelNumber) { autoCounter++; modelNumber = `AUTO-${String(autoCounter).padStart(3, "0")}`; flags.push("auto_generated_model"); }

    products.push(buildParsedProduct(modelNumber, row[columnMap.description] || "Unknown", row[columnMap.category] || detectCategory(row[columnMap.description] || ""), rawPrice, calc, isInclVat, effectiveDiscount, settings.markupPercent, vatDetection.confidence, flags));
  }

  if (autoCounter > 0) warnings.push(`${autoCounter} products had no model number`);

  return buildPreview(products, effectiveInclVat, effectiveDiscount, settings, vatDetection, discountDetection, warnings, "csv", columnMap);
}

// ─── BUILDER HELPERS ───

function buildParsedProduct(
  model: string, desc: string, category: string, rawPrice: number,
  calc: ReturnType<typeof calculateImportPrices>,
  isInclVat: boolean, discount: number, markup: number,
  confidence: "high" | "medium" | "low", flags: string[] = []
): ParsedProduct {
  return {
    model_number: model, description: desc, category, raw_price: rawPrice,
    cost_price: calc.cost_price, selling_price: calc.selling_price,
    selling_price_incl_vat: calc.selling_price_incl_vat, default_markup_percent: markup,
    confidence, flags,
    price_excl_vat: calc.price_excl_vat, price_includes_vat: isInclVat,
    price_list_type: discount > 0 ? "list_price_with_discount" : "cost_price",
    supplier_discount_percent: discount, markup_percent: markup,
    calculated_price: calc.selling_price, vat_amount: r2(calc.selling_price * VAT_RATE),
    sell_price_incl_vat: calc.selling_price_incl_vat,
  };
}

function buildPreview(
  products: ParsedProduct[], inclVat: boolean, discount: number,
  settings: SupplierPricingSettings, vatDet: any, discDet: any,
  warnings: string[], method: ImportPreview["parseMethod"], columnMap?: Record<string, string>
): ImportPreview {
  return {
    products, detectedPriceType: inclVat ? "incl_vat" : "excl_vat",
    detectedDiscount: discount, suggestedMarkup: settings.markupPercent,
    totalProducts: products.length, warnings, columnMap,
    vatEvidence: vatDet.evidence, discountEvidence: discount > 0 ? discDet.evidence : "N/A",
    vatConfidence: vatDet.confidence, discountConfidence: discount > 0 ? discDet.confidence : "high",
    supplierSettings: settings, parseMethod: method,
  };
}

function emptyPreview(warning: string, settings: SupplierPricingSettings): ImportPreview {
  return {
    products: [], detectedPriceType: "unknown", detectedDiscount: 0,
    suggestedMarkup: settings.markupPercent, totalProducts: 0, warnings: [warning],
    vatEvidence: "N/A", discountEvidence: "N/A", vatConfidence: "low", discountConfidence: "low",
    supplierSettings: settings,
  };
}
