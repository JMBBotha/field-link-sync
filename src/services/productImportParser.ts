import { VAT_RATE } from "@/utils/pricing";
import { supabase } from "@/integrations/supabase/client";

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
  parseMethod?: "ai" | "regex" | "csv";
}

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
  settingsOverride?: Partial<SupplierPricingSettings>
): Promise<ImportPreview> {
  const dbSettings = await getSupplierPricingSettings(supplierId);
  const settings: SupplierPricingSettings = { ...dbSettings, ...settingsOverride };

  if (file.name.endsWith(".csv") || file.type === "text/csv") {
    return parseCSVFile(file, settings);
  }
  return parsePDFFile(file, settings, supplierId);
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
// AI-ENHANCED PDF PARSING
// ─────────────────────────────────────────
const CHUNK_SIZE = 12000;

async function tryAIParsePDF(
  file: File,
  supplierId: string,
  supplierName: string
): Promise<{ products: Array<{ model: string; description: string; price: number; category: string }>; success: boolean }> {
  try {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    // Extract text from all pages
    let allText = "";
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(" ");
      allText += pageText + "\n";
    }

    if (allText.trim().length < 50) {
      console.log("[AI Parse] Insufficient text extracted from PDF");
      return { products: [], success: false };
    }

    // Split into chunks for the edge function
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

    console.log(`[AI Parse] Sending ${chunks.length} chunks to AI parser`);

    const allProducts: Array<{ model: string; description: string; price: number; category: string }> = [];

    for (let ci = 0; ci < chunks.length; ci++) {
      const { data, error } = await supabase.functions.invoke("parse-pdf-with-grok", {
        body: {
          extracted_text: chunks[ci],
          supplier_id: supplierId,
          supplier_name: supplierName,
          chunk_index: ci,
          chunk_total: chunks.length,
        },
      });

      if (error) {
        console.warn(`[AI Parse] Chunk ${ci} error:`, error);
        continue;
      }

      const products = data?.products || [];
      for (const p of products) {
        const costPrice = typeof p.cost_price === "number" ? p.cost_price : 
          (p.prices ? Object.values(p.prices)[0] as number : 0);
        if (costPrice > 0) {
          allProducts.push({
            model: p.product_code || p.sku || "",
            description: p.description || p.name || "",
            price: costPrice,
            category: p.product_category || p.category || "Air Conditioning",
          });
        }
      }
    }

    console.log(`[AI Parse] Total products extracted: ${allProducts.length}`);
    return { products: allProducts, success: allProducts.length > 0 };
  } catch (err) {
    console.warn("[AI Parse] Failed:", err);
    return { products: [], success: false };
  }
}

// ─────────────────────────────────────────
// PDF PARSER (AI-first, regex fallback)
// ─────────────────────────────────────────
async function parsePDFFile(file: File, settings: SupplierPricingSettings, supplierId?: string): Promise<ImportPreview> {
  let parseMethod: "ai" | "regex" = "regex";
  let rawRows: Array<{ model: string; description: string; price: number; category: string }> = [];

  // Try AI parsing first
  if (supplierId) {
    console.log("[Parser] Attempting AI-enhanced parsing...");
    const aiResult = await tryAIParsePDF(file, supplierId, settings.supplierName);
    if (aiResult.success && aiResult.products.length > 0) {
      rawRows = aiResult.products;
      parseMethod = "ai";
      console.log(`[Parser] AI parsing succeeded with ${rawRows.length} products`);
    }
  }

  // Fallback to regex if AI didn't produce results
  if (rawRows.length === 0) {
    console.log("[Parser] Using regex text extraction fallback...");
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let allText = "";

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(" ");
      allText += pageText + "\n";

      const pricePattern = /([A-Z0-9][A-Z0-9\-\/]{4,29})\s+([A-Za-z0-9\s\-\/,\.]{10,80}?)\s+R?\s*([\d,]+\.?\d{0,2})/g;
      let match;
      while ((match = pricePattern.exec(pageText)) !== null) {
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
    }
  }

  // Extract text for VAT/discount detection
  let allText = "";
  try {
    const pdfjsLib = await import("pdfjs-dist");
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    for (let pageNum = 1; pageNum <= Math.min(pdf.numPages, 3); pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      allText += textContent.items.map((item: any) => item.str).join(" ") + "\n";
    }
  } catch (_) {}

  const vatDetection = detectVATInclusion(allText, [allText.substring(0, 500)]);
  const discountDetection = detectDiscount(allText);
  const warnings: string[] = [];

  const effectiveInclVat = vatDetection.confidence === "high" ? vatDetection.isIncl : settings.priceIncludesVat;
  const effectiveDiscount = settings.priceListType === "list_price_with_discount"
    ? (discountDetection.confidence === "high" ? discountDetection.percent : settings.tradeDiscount)
    : 0;

  if (vatDetection.confidence === "low") {
    warnings.push("⚠️ Could not confidently detect VAT inclusion — please verify below");
  }

  if (parseMethod === "regex") {
    warnings.push("📝 Parsed using text extraction — results may be less accurate for complex layouts");
  }

  // Deduplicate by model number
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
      confidence: parseMethod === "ai" ? "high" : vatDetection.confidence,
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
// CSV PARSER
// ─────────────────────────────────────────
async function parseCSVFile(file: File, settings: SupplierPricingSettings): Promise<ImportPreview> {
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
