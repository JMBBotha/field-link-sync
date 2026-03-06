import { VAT_RATE } from "@/utils/pricing";
import { supabase } from "@/integrations/supabase/client";
import { renderPDFToImages, enhancePDFPages } from "@/utils/pdfEnhancer";

export type PriceListType = "cost_price" | "list_price_with_discount";

export interface SupplierPricingSettings {
  supplierName: string;
  priceListType: PriceListType;
  tradeDiscount: number;
  markupPercent: number;
  priceIncludesVat: boolean;
}

export interface ParsedProduct {
  model_number: string;
  description: string;
  category: string;
  raw_price: number;
  price_includes_vat: boolean;
  price_excl_vat: number;
  price_list_type: PriceListType;
  supplier_discount_percent: number;
  cost_price: number;
  markup_percent: number;
  calculated_price: number;
  vat_amount: number;
  sell_price_incl_vat: number;
  confidence: "high" | "medium" | "low";
  flags: string[];
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
}

export type ImportStage =
  | { stage: "loading_pdf"; detail: string }
  | { stage: "rendering_pages"; done: number; total: number }
  | { stage: "enhancing_images"; done: number; total: number }
  | { stage: "ai_extraction"; detail: string }
  | { stage: "text_fallback"; detail: string }
  | { stage: "complete"; detail: string };

// ─────────────────────────────────────────
// FETCH SUPPLIER PRICING SETTINGS
// ─────────────────────────────────────────
export async function getSupplierPricingSettings(supplierId: string): Promise<SupplierPricingSettings> {
  const { data: supplier } = await (supabase
    .from("suppliers") as any)
    .select("name, price_list_type, default_trade_discount, default_markup_percent")
    .eq("id", supplierId)
    .single();

  return {
    supplierName: supplier?.name || "",
    priceListType: supplier?.price_list_type || "cost_price",
    tradeDiscount: supplier?.default_trade_discount ?? 0,
    markupPercent: supplier?.default_markup_percent ?? 20,
    priceIncludesVat: false,
  };
}

// ─────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────
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

// ─────────────────────────────────────────
// VAT DETECTION ENGINE
// ─────────────────────────────────────────
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
    return { isIncl: false, confidence: "medium", evidence: "Separate VAT column detected — prices likely excl VAT" };

  if (/\bRRP\b|RECOMMENDED\s*RETAIL/.test(upperText))
    return { isIncl: true, confidence: "medium", evidence: "RRP detected — typically incl VAT in SA" };

  return { isIncl: false, confidence: "low", evidence: "Could not determine — defaulting to excl VAT" };
}

function detectDiscount(
  text: string
): { percent: number; confidence: "high" | "medium" | "low"; evidence: string } {
  const upperText = text.toUpperCase();

  const discountMatch = upperText.match(/(?:TRADE\s*)?DISCOUNT[:\s]+(\d{1,2}(?:\.\d+)?)\s*%/);
  if (discountMatch)
    return { percent: parseFloat(discountMatch[1]), confidence: "high", evidence: `Discount stated in document: ${discountMatch[1]}%` };

  const lessMatch = upperText.match(/LESS\s+(\d{1,2}(?:\.\d+)?)\s*%/);
  if (lessMatch)
    return { percent: parseFloat(lessMatch[1]), confidence: "high", evidence: `"Less ${lessMatch[1]}%" found in document` };

  if (/DEALER|RESELLER|NET\s*PRICE/.test(upperText))
    return { percent: 0, confidence: "medium", evidence: "Dealer/net price column detected — discount may be pre-applied" };

  return { percent: 0, confidence: "low", evidence: "No discount detected" };
}

// ─────────────────────────────────────────
// PRICE CALCULATION ENGINE
// ─────────────────────────────────────────
export function calculateImportPrices(
  rawPrice: number,
  priceListType: PriceListType,
  isInclVat: boolean,
  discountPercent: number,
  markupPercent: number
) {
  const price_excl_vat = isInclVat
    ? parseFloat((rawPrice / (1 + VAT_RATE)).toFixed(2))
    : rawPrice;

  const cost_price = priceListType === "list_price_with_discount"
    ? parseFloat((price_excl_vat * (1 - discountPercent / 100)).toFixed(2))
    : price_excl_vat;

  const calculated_price = parseFloat((cost_price * (1 + markupPercent / 100)).toFixed(2));
  const vat_amount = parseFloat((calculated_price * VAT_RATE).toFixed(2));
  const sell_price_incl_vat = parseFloat((calculated_price + vat_amount).toFixed(2));

  return { price_excl_vat, cost_price, calculated_price, vat_amount, sell_price_incl_vat };
}

export function recalculateProducts(
  products: ParsedProduct[],
  priceListType: PriceListType,
  isInclVat: boolean,
  discountPercent: number,
  markupPercent: number
): ParsedProduct[] {
  return products.map((p) => {
    const calc = calculateImportPrices(p.raw_price, priceListType, isInclVat, discountPercent, markupPercent);
    const flags: string[] = [];
    if (isInclVat) flags.push("price_incl_vat_stripped");
    if (priceListType === "list_price_with_discount" && discountPercent > 0)
      flags.push(`discount_${discountPercent}pct_applied`);
    return {
      ...p,
      price_includes_vat: isInclVat,
      price_list_type: priceListType,
      supplier_discount_percent: priceListType === "list_price_with_discount" ? discountPercent : 0,
      markup_percent: markupPercent,
      flags,
      ...calc,
    };
  });
}

// ─────────────────────────────────────────
// FULL PDF PIPELINE: Render → Enhance → Grok → Lovable AI → Regex
// ─────────────────────────────────────────
const CHUNK_SIZE = 12000;

async function parsePDFWithFullPipeline(
  file: File,
  settings: SupplierPricingSettings,
  supplierId: string,
  onStage?: (stage: ImportStage) => void
): Promise<ImportPreview> {
  let parseMethod: ImportPreview["parseMethod"] = "regex";
  let rawRows: Array<{ model: string; description: string; price: number; category: string; btu_rating?: number | null; pipe_size?: string | null; refrigerant_type?: string | null; phase?: string | null; speed_type?: string | null; kw?: number | null; unit_type?: string | null; short_name?: string | null; brand?: string | null; product_category?: string | null; sold_in_length?: boolean; unit_length?: number | null; price_per_metre?: number | null }> = [];

  // STAGE 1: Render PDF pages to images + extract text
  onStage?.({ stage: "loading_pdf", detail: `Loading ${file.name}...` });
  const { images, numPages, allText } = await renderPDFToImages(file, 2.0, (done, total) => {
    onStage?.({ stage: "rendering_pages", done, total });
  });
  console.log(`[Import] PDF loaded: ${numPages} pages, ${allText.length} chars text`);

  // STAGE 2: Enhancement SKIPPED by default — raw renders at 2.25x are sufficient
  // Deep-Image.ai can be triggered manually post-import if needed
  let enhancedImages = images;
  console.log(`[Import] Skipping Deep-Image.ai enhancement (disabled by default)`);


  // STAGE 3: Try Grok AI extraction (parse-pdf-with-grok) using extracted text in chunks
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

    console.log(`[Import] Sending ${chunks.length} chunks to parse-pdf-with-grok`);
    for (let ci = 0; ci < chunks.length; ci++) {
      onStage?.({ stage: "ai_extraction", detail: `Grok AI: chunk ${ci + 1}/${chunks.length}...` });
      const { data, error } = await supabase.functions.invoke("parse-pdf-with-grok", {
        body: {
          extracted_text: chunks[ci],
          supplier_id: supplierId,
          supplier_name: settings.supplierName,
          chunk_index: ci,
          chunk_total: chunks.length,
        },
      });

      if (error) {
        console.warn(`[Import] Grok chunk ${ci} error:`, error);
        continue;
      }

      const products = data?.products || [];
      for (const p of products) {
        const costPrice = typeof p.cost_price === "number" ? p.cost_price :
          (p.prices ? Object.values(p.prices)[0] as number : 0);
        if (costPrice > 0) {
          rawRows.push({
            model: p.product_code || p.sku || "",
            description: p.description || p.name || "",
            price: costPrice,
            category: p.product_category || p.category || "Air Conditioning",
            btu_rating: p.btu_rating || null,
            pipe_size: p.pipe_size || null,
            refrigerant_type: p.refrigerant_type || null,
            phase: p.phase || null,
            speed_type: p.speed_type || null,
            kw: p.kw || null,
            unit_type: p.unit_type || null,
            short_name: p.short_name || null,
            brand: p.brand || null,
            product_category: p.product_category || null,
            sold_in_length: p.sold_in_length || false,
            unit_length: p.unit_length || null,
            price_per_metre: p.price_per_metre || null,
          });
        }
      }
    }

    if (rawRows.length > 0) {
      parseMethod = "grok_ai";
      console.log(`[Import] Grok AI extracted ${rawRows.length} products`);
    }
  } catch (err) {
    console.warn("[Import] Grok AI parsing failed:", err);
  }

  // STAGE 4: Fallback to Lovable AI (parse-price-list) if Grok didn't produce results
  if (rawRows.length === 0 && allText.trim().length > 50) {
    onStage?.({ stage: "ai_extraction", detail: "Trying Lovable AI..." });
    try {
      const { data, error } = await supabase.functions.invoke("parse-price-list", {
        body: {
          csv_text: allText.substring(0, 15000),
          supplier_id: supplierId,
          supplier_name: settings.supplierName,
        },
      });

      if (!error) {
        const products = data?.products || (Array.isArray(data) ? data : []);
        for (const p of products) {
          const price = p.cost_price || 0;
          if (price > 0) {
            rawRows.push({
              model: p.product_code || "",
              description: p.description || "",
              price,
              category: p.category || "Air Conditioning",
            });
          }
        }
        if (rawRows.length > 0) {
          parseMethod = "lovable_ai";
          console.log(`[Import] Lovable AI extracted ${rawRows.length} products`);
        }
      }
    } catch (err) {
      console.warn("[Import] Lovable AI parsing failed:", err);
    }
  }

  // STAGE 5: Last resort — local regex text extraction
  if (rawRows.length === 0) {
    onStage?.({ stage: "text_fallback", detail: "Using text extraction fallback..." });
    console.log("[Import] Using regex text extraction fallback...");

    const pricePattern = /([A-Z0-9][A-Z0-9\-\/]{4,29})\s+([A-Za-z0-9\s\-\/,\.]{10,80}?)\s+R?\s*([\d,]+\.?\d{0,2})/g;
    let match;
    while ((match = pricePattern.exec(allText)) !== null) {
      const price = parseFloat(match[3].replace(/,/g, ""));
      if (price > 0 && price < 1_000_000) {
        rawRows.push({
          model: match[1].trim(),
          description: match[2].trim(),
          price,
          category: detectCategory(match[2]),
        });
      }
    }
    parseMethod = "regex";
  }

  onStage?.({ stage: "complete", detail: `${rawRows.length} products found` });

  // VAT / Discount detection
  const vatDetection = detectVATInclusion(allText, [allText.substring(0, 500)]);
  const discountDetection = detectDiscount(allText);
  const warnings: string[] = [];

  const effectiveInclVat = vatDetection.confidence === "high" ? vatDetection.isIncl : settings.priceIncludesVat;
  const effectiveDiscount = settings.priceListType === "list_price_with_discount"
    ? (discountDetection.confidence === "high" ? discountDetection.percent : settings.tradeDiscount)
    : 0;

  if (vatDetection.confidence === "low")
    warnings.push("⚠️ Could not confidently detect VAT inclusion — please verify below");
  if (parseMethod === "regex")
    warnings.push("📝 Parsed using text extraction — results may be less accurate for complex layouts");
  if (parseMethod === "lovable_ai")
    warnings.push("🤖 Parsed using Lovable AI — review results for accuracy");

  // Deduplicate
  const seen = new Set<string>();
  const uniqueRows = rawRows.filter((r) => {
    const key = r.model.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const products: ParsedProduct[] = uniqueRows.map((row) => {
    const calc = calculateImportPrices(row.price, settings.priceListType, effectiveInclVat, effectiveDiscount, settings.markupPercent);
    const flags: string[] = [];
    if (effectiveInclVat) flags.push("price_incl_vat_stripped");
    if (settings.priceListType === "list_price_with_discount" && effectiveDiscount > 0)
      flags.push(`discount_${effectiveDiscount}pct_applied`);

    return {
      model_number: row.model,
      description: row.description,
      category: row.category,
      raw_price: row.price,
      price_includes_vat: effectiveInclVat,
      price_list_type: settings.priceListType,
      supplier_discount_percent: settings.priceListType === "list_price_with_discount" ? effectiveDiscount : 0,
      markup_percent: settings.markupPercent,
      confidence: (parseMethod === "grok_ai" || parseMethod === "ai") ? "high" : parseMethod === "lovable_ai" ? "medium" : vatDetection.confidence,
      flags,
      ...calc,
    };
  });

  return {
    products,
    detectedPriceType: effectiveInclVat ? "incl_vat" : "excl_vat",
    detectedDiscount: effectiveDiscount,
    suggestedMarkup: settings.markupPercent,
    totalProducts: products.length,
    warnings,
    vatEvidence: vatDetection.evidence,
    discountEvidence: settings.priceListType === "cost_price" ? "N/A — Cost price supplier" : discountDetection.evidence,
    vatConfidence: vatDetection.confidence,
    discountConfidence: settings.priceListType === "cost_price" ? "high" : discountDetection.confidence,
    supplierSettings: settings,
    parseMethod,
  };
}

function detectCategory(description: string): string {
  const d = description.toUpperCase();
  if (/SPLIT|WALL\s*MOUNT|CASSETTE|DUCTED|FLOOR|CEILING/.test(d)) return "Air Conditioning";
  if (/HEAT\s*PUMP|WATER\s*HEAT|GEYSER/.test(d)) return "Water Heaters";
  if (/INVERTER|BATTERY|SOLAR/.test(d)) return "Inverters";
  if (/COPPER|PIPE|FLARE|ELBOW|FITTING|TAPE|CABLE|BRACKET/.test(d)) return "Consumables";
  if (/REMOTE|CONTROLLER/.test(d)) return "Air Conditioning";
  return "Air Conditioning";
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// ─────────────────────────────────────────
// CSV PARSER — tries Lovable AI first, then local
// ─────────────────────────────────────────
async function parseCSVFile(file: File, settings: SupplierPricingSettings, supplierId?: string): Promise<ImportPreview> {
  const text = await file.text();
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return emptyPreview("CSV file has no data rows", settings);

  const headers = parseCSVLine(lines[0]);
  const vatDetection = detectVATInclusion(text, headers);
  const discountDetection = detectDiscount(text);

  const effectiveInclVat = vatDetection.confidence === "high" ? vatDetection.isIncl : settings.priceIncludesVat;
  const effectiveDiscount = settings.priceListType === "list_price_with_discount"
    ? (discountDetection.confidence === "high" ? discountDetection.percent : settings.tradeDiscount)
    : 0;

  // Try Lovable AI parse-price-list first for CSV
  if (supplierId) {
    try {
      const { data, error } = await supabase.functions.invoke("parse-price-list", {
        body: {
          csv_text: text.substring(0, 15000),
          supplier_id: supplierId,
          supplier_name: settings.supplierName,
        },
      });

      if (!error) {
        const aiProducts = data?.products || (Array.isArray(data) ? data : []);
        const validProducts = aiProducts.filter((p: any) => (p.cost_price || 0) > 0);

        if (validProducts.length > 0) {
          console.log(`[Import] Lovable AI CSV: ${validProducts.length} products`);
          const products: ParsedProduct[] = validProducts.map((p: any) => {
            const rawPrice = p.cost_price || 0;
            const calc = calculateImportPrices(rawPrice, settings.priceListType, effectiveInclVat, effectiveDiscount, settings.markupPercent);
            return {
              model_number: p.product_code || "",
              description: p.description || "",
              category: p.category || "Air Conditioning",
              raw_price: rawPrice,
              price_includes_vat: effectiveInclVat,
              price_list_type: settings.priceListType,
              supplier_discount_percent: settings.priceListType === "list_price_with_discount" ? effectiveDiscount : 0,
              markup_percent: settings.markupPercent,
              confidence: "high" as const,
              flags: [],
              ...calc,
            };
          });

          return {
            products,
            detectedPriceType: effectiveInclVat ? "incl_vat" : "excl_vat",
            detectedDiscount: effectiveDiscount,
            suggestedMarkup: settings.markupPercent,
            totalProducts: products.length,
            warnings: [],
            vatEvidence: vatDetection.evidence,
            discountEvidence: settings.priceListType === "cost_price" ? "N/A — Cost price supplier" : discountDetection.evidence,
            vatConfidence: vatDetection.confidence,
            discountConfidence: settings.priceListType === "cost_price" ? "high" : discountDetection.confidence,
            supplierSettings: settings,
            parseMethod: "lovable_ai",
          };
        }
      }
    } catch (err) {
      console.warn("[Import] Lovable AI CSV parsing failed, using local:", err);
    }
  }

  // Fallback: local CSV parsing
  const columnMap: Record<string, string> = {};
  for (const header of headers) {
    const h = header.toUpperCase();
    if (/MODEL|PART.?NO|SKU|CODE/.test(h) && !columnMap.model) columnMap.model = header;
    else if (/DESC|NAME|PRODUCT/.test(h) && !columnMap.description) columnMap.description = header;
    else if (/CATEGORY|TYPE|GROUP/.test(h) && !columnMap.category) columnMap.category = header;
    else if (/EXCL.*VAT|EX.*VAT/.test(h)) columnMap.price_excl = header;
    else if (/INCL.*VAT|INC.*VAT/.test(h)) columnMap.price_incl = header;
    else if (/PRICE|COST|RATE|RRP/.test(h) && !/VAT/.test(h) && !columnMap.price) columnMap.price = header;
    else if (/DISCOUNT|DISC/.test(h) && !columnMap.discount) columnMap.discount = header;
  }

  const products: ParsedProduct[] = [];
  const warnings: string[] = [];
  let autoCounter = 0;

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => (row[h] = values[idx] || ""));

    const priceCol = columnMap.price_excl || columnMap.price || columnMap.price_incl;
    if (!priceCol || !row[priceCol]) continue;

    const rawPrice = parseFloat(row[priceCol]?.replace(/[R,\s]/g, "") || "0");
    if (!rawPrice || rawPrice <= 0) continue;

    const isInclVat = columnMap.price_incl ? priceCol === columnMap.price_incl : effectiveInclVat;
    const calc = calculateImportPrices(rawPrice, settings.priceListType, isInclVat, effectiveDiscount, settings.markupPercent);
    const flags: string[] = [];
    if (isInclVat) flags.push("price_incl_vat_stripped");
    if (settings.priceListType === "list_price_with_discount" && effectiveDiscount > 0)
      flags.push(`discount_${effectiveDiscount}pct_applied`);

    let modelNumber = row[columnMap.model] || "";
    if (!modelNumber) {
      autoCounter++;
      modelNumber = `AUTO-${String(autoCounter).padStart(3, "0")}`;
      flags.push("auto_generated_model");
    }

    products.push({
      model_number: modelNumber,
      description: row[columnMap.description] || "Unknown",
      category: row[columnMap.category] || detectCategory(row[columnMap.description] || ""),
      raw_price: rawPrice,
      price_includes_vat: isInclVat,
      price_list_type: settings.priceListType,
      supplier_discount_percent: settings.priceListType === "list_price_with_discount" ? effectiveDiscount : 0,
      markup_percent: settings.markupPercent,
      confidence: vatDetection.confidence,
      flags,
      ...calc,
    });
  }

  if (autoCounter > 0) {
    warnings.push(`${autoCounter} products had no model number — assigned AUTO-001 to AUTO-${String(autoCounter).padStart(3, "0")}`);
  }

  return {
    products,
    detectedPriceType: effectiveInclVat ? "incl_vat" : "excl_vat",
    detectedDiscount: effectiveDiscount,
    suggestedMarkup: settings.markupPercent,
    totalProducts: products.length,
    warnings,
    columnMap,
    vatEvidence: vatDetection.evidence,
    discountEvidence: settings.priceListType === "cost_price" ? "N/A — Cost price supplier" : discountDetection.evidence,
    vatConfidence: vatDetection.confidence,
    discountConfidence: settings.priceListType === "cost_price" ? "high" : discountDetection.confidence,
    supplierSettings: settings,
    parseMethod: "csv",
  };
}

function emptyPreview(warning: string, settings: SupplierPricingSettings): ImportPreview {
  return {
    products: [],
    detectedPriceType: "unknown",
    detectedDiscount: 0,
    suggestedMarkup: settings.markupPercent,
    totalProducts: 0,
    warnings: [warning],
    vatEvidence: "N/A",
    discountEvidence: "N/A",
    vatConfidence: "low",
    discountConfidence: "low",
    supplierSettings: settings,
  };
}
