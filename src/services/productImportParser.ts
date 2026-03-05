import { VAT_RATE } from "@/utils/pricing";

export interface ParsedProduct {
  model_number: string;
  description: string;
  category: string;
  raw_price: number;
  price_includes_vat: boolean;
  price_excl_vat: number;
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
}

// ─────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────
export async function parseImportFile(
  file: File,
  supplierName: string,
  defaultMarkup: number = 20
): Promise<ImportPreview> {
  if (file.name.endsWith(".csv") || file.type === "text/csv") {
    return parseCSVFile(file, supplierName, defaultMarkup);
  }
  return parsePDFFile(file, supplierName, defaultMarkup);
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

  // Check for RRP column header — typically incl VAT in South Africa
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
  isInclVat: boolean,
  discountPercent: number,
  markupPercent: number
) {
  const price_excl_vat = isInclVat
    ? parseFloat((rawPrice / (1 + VAT_RATE)).toFixed(2))
    : rawPrice;

  const cost_price = parseFloat((price_excl_vat * (1 - discountPercent / 100)).toFixed(2));
  const calculated_price = parseFloat((cost_price * (1 + markupPercent / 100)).toFixed(2));
  const vat_amount = parseFloat((calculated_price * VAT_RATE).toFixed(2));
  const sell_price_incl_vat = parseFloat((calculated_price + vat_amount).toFixed(2));

  return { price_excl_vat, cost_price, calculated_price, vat_amount, sell_price_incl_vat };
}

// Re-calculate all products with new settings
export function recalculateProducts(
  products: ParsedProduct[],
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
      price_includes_vat: isInclVat,
      supplier_discount_percent: discountPercent,
      markup_percent: markupPercent,
      flags,
      ...calc,
    };
  });
}

// ─────────────────────────────────────────
// CSV PARSER
// ─────────────────────────────────────────
async function parseCSVFile(file: File, _supplierName: string, defaultMarkup: number): Promise<ImportPreview> {
  const text = await file.text();
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) {
    return emptyPreview("CSV file has no data rows", defaultMarkup);
  }

  const headers = parseCSVLine(lines[0]);
  const vatDetection = detectVATInclusion(text, headers);
  const discountDetection = detectDiscount(text);

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

    const rowDiscount = row[columnMap.discount]
      ? parseFloat(row[columnMap.discount])
      : discountDetection.percent;

    const isInclVat = columnMap.price_incl ? priceCol === columnMap.price_incl : vatDetection.isIncl;

    const calc = calculateImportPrices(rawPrice, isInclVat, rowDiscount, defaultMarkup);
    const flags: string[] = [];
    if (isInclVat) flags.push("price_incl_vat_stripped");
    if (rowDiscount > 0) flags.push(`discount_${rowDiscount}pct_applied`);

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
      supplier_discount_percent: rowDiscount,
      markup_percent: defaultMarkup,
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
    detectedPriceType: vatDetection.isIncl ? "incl_vat" : "excl_vat",
    detectedDiscount: discountDetection.percent,
    suggestedMarkup: defaultMarkup,
    totalProducts: products.length,
    warnings,
    columnMap,
    vatEvidence: vatDetection.evidence,
    discountEvidence: discountDetection.evidence,
    vatConfidence: vatDetection.confidence,
    discountConfidence: discountDetection.confidence,
  };
}

// ─────────────────────────────────────────
// PDF PARSER
// ─────────────────────────────────────────
async function parsePDFFile(file: File, _supplierName: string, defaultMarkup: number): Promise<ImportPreview> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let allText = "";
  const allRows: Array<{ model: string; description: string; price: number; category: string }> = [];

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
        allRows.push({
          model: match[1].trim(),
          description: match[2].trim(),
          price,
          category: detectCategory(match[2]),
        });
      }
    }
  }

  const vatDetection = detectVATInclusion(allText, [allText.substring(0, 500)]);
  const discountDetection = detectDiscount(allText);
  const warnings: string[] = [];

  if (vatDetection.confidence === "low") {
    warnings.push("⚠️ Could not confidently detect VAT inclusion — please verify below");
  }

  // Deduplicate by model number
  const seen = new Set<string>();
  const uniqueRows = allRows.filter((r) => {
    if (seen.has(r.model)) return false;
    seen.add(r.model);
    return true;
  });

  const products: ParsedProduct[] = uniqueRows.map((row) => {
    const calc = calculateImportPrices(row.price, vatDetection.isIncl, discountDetection.percent, defaultMarkup);
    const flags: string[] = [];
    if (vatDetection.isIncl) flags.push("price_incl_vat_stripped");
    if (discountDetection.percent > 0) flags.push(`discount_${discountDetection.percent}pct_applied`);

    return {
      model_number: row.model,
      description: row.description,
      category: row.category,
      raw_price: row.price,
      price_includes_vat: vatDetection.isIncl,
      supplier_discount_percent: discountDetection.percent,
      markup_percent: defaultMarkup,
      confidence: vatDetection.confidence,
      flags,
      ...calc,
    };
  });

  return {
    products,
    detectedPriceType: vatDetection.isIncl ? "incl_vat" : "excl_vat",
    detectedDiscount: discountDetection.percent,
    suggestedMarkup: defaultMarkup,
    totalProducts: products.length,
    warnings,
    vatEvidence: vatDetection.evidence,
    discountEvidence: discountDetection.evidence,
    vatConfidence: vatDetection.confidence,
    discountConfidence: discountDetection.confidence,
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

function emptyPreview(warning: string, defaultMarkup: number): ImportPreview {
  return {
    products: [],
    detectedPriceType: "unknown",
    detectedDiscount: 0,
    suggestedMarkup: defaultMarkup,
    totalProducts: 0,
    warnings: [warning],
    vatEvidence: "N/A",
    discountEvidence: "N/A",
    vatConfidence: "low",
    discountConfidence: "low",
  };
}
