// ─── Shared config values ───
const SHARED_VAT_RATE = 0.15;
const SHARED_MIN_PRICE = 0.01;
const SHARED_MAX_PRICE = 1_000_000;
const SHARED_MIN_CODE_LEN = 2;
const SHARED_VALID_CATEGORIES = ["Air Conditioning", "Water Heaters", "Inverters", "Batteries", "Consumables"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ParsedProduct {
  sku: string;
  name: string;
  description: string;
  category: string;
  prices: Record<string, number>;
  pipeSize?: string | null;
  btuRating?: number | null;
  refrigerantType?: string | null;
  shortName?: string | null;
  soldInLength?: boolean;
  unitLength?: number | null;
  unitLengthUnit?: string;
  pricePerMetre?: number | null;
  minCutLength?: number;
  productCategory?: string;
  brand?: string | null;
  phase?: string | null;
  speedType?: string | null;
  kw?: number | null;
  unitType?: string | null;
  pageNumber?: number | null;
  rowBbox?: BBox | null;
  priceBbox?: BBox | null;
}

const CHUNK_SIZE = 12000;
const MAX_TEXT = 250000;

const SYSTEM_PROMPT = `You are a strict HVAC and installation materials price list parser. Your job is to extract EVERY product row that has a valid Rand price (R followed by digits) in the rightmost price column.

CRITICAL RULES:
1. Extract ALL rows that have a numeric price > 0 in the rightmost price column (typically "NETT PRICE", "COST", "EXCL VAT", or similar)
2. The product category does NOT matter — extract copper, insulation, PVC, brackets, fittings, tape, gas, piping, trunking, cable, and ALL other items. If a row has a valid R price, it IS a product.
3. ONE region per product row — NEVER merge multiple product rows into one entry
4. SKIP all non-product content: headers, footers, page titles, date lines, document metadata, images, blank lines, subtotals, category headers, section dividers
5. SKIP rows where the price is 0, empty, or "POA"/"Price on Request"
6. SKIP rows that contain document metadata like "PRICELIST", "PRICE LIST", "VALID FROM", dates, or version numbers — these are NOT products
7. Every valid priced product row MUST be extracted — do not miss any
8. Each product must have a unique SKU/product_code — if two rows have the same code, they are separate entries (e.g. indoor + outdoor unit)
9. If a row has an R value (price > 0) in the right-side column of the PDF, it IS a product. If it has no R value, it is NOT a product. Period.

Return JSON: {"detected_price_columns":[...],"products":[...]}

Product fields:
- sku: string (the product/model code)
- name: string (product name/model)
- description: string (full description text from the row)
- category: string (subcategory like "Midwall Inverter", "Cassette", "Ducted", "Copper", "Insulation", "PVC", "Brackets", etc.)
- prices: object mapping column name → numeric price value
- pipeSize, btuRating, refrigerantType, shortName, productCategory, brand, phase, speedType, kw, unitType
- pageNumber: integer (1-indexed PDF page)
- rowBbox: {x, y, width, height} normalized 0-1 coordinates for the ENTIRE product row
- priceBbox: {x, y, width, height} normalized 0-1 coordinates for the PRICE VALUE ONLY (rightmost numeric amount)

BOUNDING BOX RULES:
- rowBbox must tightly wrap ONLY the single product row, not multiple rows
- rowBbox height should be ~1-3% of page height (one text line)
- priceBbox must target the rightmost price number only
- Both use normalized coordinates (0-1 relative to page dimensions)
- If you cannot determine exact coordinates, omit these fields — do NOT guess

SPECIFICATION EXTRACTION:
- btuRating: from "9000 BTU", "9K BTU", or derive from kW (2.6kW=9000, 3.5kW=12000, 5.0kW=18000, 7.0kW=24000)
- kw: from "2.6kW", "3.5 kW" etc. If only BTU: BTU/3412=kW
- pipeSize: "1/4 x 3/8", "6.35/9.52" etc.
- refrigerantType: "R410A", "R32", "R22", "R290"
- phase: "Single Phase" or "Three Phase" (from "1Ph", "3Ph", "380V" etc.)
- speedType: "Inverter" or "Fixed Speed" (from "INV", "DC inverter", "fixed speed" etc.)
- unitType: "Midwall", "Cassette", "Ducted", "Under Ceiling", "Floor Standing", etc.

productCategory: one of "Air Conditioning", "Water Heaters", "Inverters", "Batteries", "Consumables"
brand: detect from product name/code (Samsung=AR*, Alliance=FOUR*/ALL*, Midea, Daikin, etc.)
shortName: BRAND BTU/kW ABBREV format (e.g. "Samsung 9K INV MW")

Prices: ZAR format "R 7 700,00" = 7700. Use rightmost NETT/COST column preferentially.
Current supplier price lists mark the correct cost column with a red highlight/rectangle in the PDF to flag which price to use. For Daikin price lists specifically: the correct cost column is "INSTALLER PRICE" (the red-marked column) — NOT "RRP", NOT any "Incl Corrosion Treatment" add-on column, and NOT "Webshop Price" (older Daikin lists had a Webshop Price column; current lists no longer include one — do not look for it).

CRITICAL MULTI-COLUMN PRICE RULE: When a price list has MULTIPLE price columns per row (e.g. "Installer Price", "Incl Corrosion Treatment Partial", "Incl Corrosion Treatment Full", or "Trade", "Wholesale", "Retail"), you MUST:
1. Identify the BASE/INSTALLER/TRADE/DEALER price column (usually the LEFTMOST or LOWEST-priced column, the one WITHOUT add-ons like "Incl Corrosion", "Incl Treatment", "Incl Coating", "Incl Warranty Extended").
2. For EVERY product row, populate the prices object with ALL columns under their EXACT column header names (so {"Installer Price": 8991, "Incl Corrosion Treatment Partial": 10303, "Incl Corrosion Treatment Full": 11500}).
3. NEVER swap, shift, or merge columns between rows. The Installer Price for row 2 must come from the SAME visual column as row 1's Installer Price.
4. If a row visually only shows ONE price, label that column based on its horizontal position matching the header row above — do NOT default to the middle/right column.

SECTION HEADER DETECTION: Rows like "AR3000 Non-Inverter" or "Midwall Split Systems" with NO price are section headers — SKIP them entirely.
Document title/date rows like "CPT ONLY ONE STOP SHOP - PRICELIST NO.17 VALID FROM 13 NOVEMBER 2025" are NOT products — SKIP them.

Supplier: `;

function parseAIContent(content: string): { detected_price_columns: string[]; products: ParsedProduct[] } {
  let parsed: any = {};
  try {
    parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, "").trim());
  } catch {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { parsed = JSON.parse(jsonMatch[0]); } catch { /* skip */ }
    }
  }
  const products = (parsed.products || []).map((p: any) => {
    if (!p.prices && p.unitCost !== undefined) {
      return { ...p, prices: { "Unit Price": p.unitCost } };
    }
    return p;
  });
  return { detected_price_columns: parsed.detected_price_columns || [], products };
}

function pickBestPrice(
  prices: Record<string, number>,
): { price: number; columnName: string; isInclVat: boolean } {
  const entries = Object.entries(prices).filter(([, v]) => typeof v === "number" && v > 0);
  if (entries.length === 0) return { price: 0, columnName: "", isInclVat: false };

  // NOTE: Daikin price lists used to have a fixed List/Contractor/RRP layout
  // with a hardcoded "Contractor" column override here. Current Daikin lists
  // use "Installer Price" (the red-highlighted column) instead, and have no
  // Contractor column at all, so that override was removed — the generic
  // exclPatterns priority below (INSTALLER first) already selects the right
  // column by name for Daikin and every other supplier, without hardcoding
  // a specific column name per brand.

  if (entries.length === 1) {
    // PDF supplier price lists are always EXCL VAT (confirmed policy) — never
    // treat a single price column as INCL VAT regardless of its header wording.
    const [col, val] = entries[0];
    return { price: val, columnName: col, isInclVat: false };
  }

  // Reject any "Incl <add-on>" columns (corrosion treatment, coating, warranty, etc.) — they are NOT base prices
  const isAddOnIncl = (col: string) =>
    /INCL.*(CORROSION|TREATMENT|COATING|WARRANTY|EXTENDED|INSTALL|DELIVERY)/i.test(col);
  const baseEntries = entries.filter(([col]) => !isAddOnIncl(col));
  const pool = baseEntries.length > 0 ? baseEntries : entries;

  // Prefer Installer / Dealer / Trade / Cost / Net / Excl columns first
  const exclPatterns = [/INSTALLER/i, /DEALER/i, /TRADE/i, /\bCOST\b/i, /\bNET\b/i, /EXCL/i, /EX\s*VAT/i];
  for (const pattern of exclPatterns) {
    const match = pool.find(([col]) => pattern.test(col));
    if (match) return { price: match[1], columnName: match[0], isInclVat: false };
  }

  // Webshop price fallback for any supplier whose only price column is literally named
  // "Webshop Price" (no longer Daikin — current Daikin lists use "Installer Price", already
  // matched by exclPatterns above) — prefer WEBSHOP PRICE over CAMPAIGN/RRP.
  const webshopPatterns = [/WEBSHOP.*PRICE/i, /\bWEBSHOP\b/i];
  for (const pattern of webshopPatterns) {
    const match = pool.find(([col]) => pattern.test(col) && !/CAMPAIGN/i.test(col));
    if (match) return { price: match[1], columnName: match[0], isInclVat: false };
  }

  const inclIdx = pool.findIndex(([col]) => /INCL|INC\b|INCLUDING/i.test(col.toUpperCase()));
  if (inclIdx !== -1 && pool.length > 1) {
    const exclEntry = pool.find((_, idx) => idx !== inclIdx);
    if (exclEntry) return { price: exclEntry[1], columnName: exclEntry[0], isInclVat: false };
  }

  // Final fallback — pick the LOWEST price in the base pool (Installer is almost always cheapest)
  pool.sort((a, b) => a[1] - b[1]);
  return { price: pool[0][1], columnName: pool[0][0], isInclVat: false };
}

function autoDetectBrand(p: ParsedProduct): string | null {
  const name = `${p.name || ""} ${p.description || ""}`;
  const code = (p.sku || "").toUpperCase();
  if (/\bSAMSUNG\b/i.test(name) || /^(AR|AJ)\d/i.test(code)) return "Samsung";
  if (/\bCOMF(Y|EE)\b/i.test(name)) return "Comfy";
  if (/\bALLIANCE\b/i.test(name) || /^(FOUR|ALL)\d/i.test(code)) return "Alliance";
  if (/\bMIDEA\b/i.test(name)) return "Midea";
  if (/\bDAIKIN\b/i.test(name) || /^(FT|RX|FK|FA|FB|FC)/i.test(code)) return "Daikin";
  return null;
}

function autoDetectCategory(p: ParsedProduct): string {
  const text = `${p.name || ""} ${p.description || ""} ${p.category || ""}`.toLowerCase();
  if (/\b(copper|cable|cabtyre|trunking|insulation|bracket|fitting|flare|tape|drain|pvc|tube\b|piping)/i.test(text)) return "Consumables";
  if (/\b(gas|refrigerant|r410a|r32|r22)\b/i.test(text) && !/\b(split|midwall|cassette|ducted)\b/i.test(text)) return "Consumables";
  if (/\b(geyser|water\s*heat|hot\s*water|heat\s*pump.*water)/i.test(text)) return "Water Heaters";
  if (/\b(battery|batteries|lithium|kwh\s*storage|powerwall|backup\s*power)/i.test(text)) return "Batteries";
  if (/\b(solar\s*inverter|hybrid\s*inverter|power\s*inverter|mppt|grid.tie)/i.test(text)) return "Inverters";
  return "Air Conditioning";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { extracted_text, supplier_id, supplier_name, supplier_type, chunk_index, chunk_total } = await req.json();
    const isConsumables = supplier_type === "consumables";
    const chunkIndex = Number.isFinite(Number(chunk_index)) ? Number(chunk_index) : 0;
    const chunkTotal = Number.isFinite(Number(chunk_total)) ? Number(chunk_total) : 1;

    console.log("[Grok] Request:", { textLength: extracted_text?.length, supplier_id, chunkIndex, chunkTotal });

    if (!extracted_text || !supplier_id) {
      return new Response(JSON.stringify({ error: "extracted_text and supplier_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const xaiApiKey = Deno.env.get("XAI_API_KEY");
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

    if (!xaiApiKey && !lovableApiKey) {
      return new Response(JSON.stringify({ error: "No API key configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let systemPrompt = SYSTEM_PROMPT + (supplier_name || "Unknown");
    if (isConsumables) {
      systemPrompt += `\n\nThis is a CONSUMABLES/INSTALLATION MATERIALS supplier. Products include piping, cable, insulation, brackets, fittings, gas, tools etc.
Detect LENGTH-BASED products with patterns like "15M", "50M", "100M".
Add fields: soldInLength (bool), unitLength (number), unitLengthUnit ("m"), pricePerMetre (cost/length), minCutLength (default 0.5).`;
    }

    const truncatedText = extracted_text.substring(0, MAX_TEXT);

    if (truncatedText.length > CHUNK_SIZE) {
      return new Response(
        JSON.stringify({
          error: `Chunk too large (${truncatedText.length} chars). Split into <= ${CHUNK_SIZE} char chunks.`,
          products: [],
          detected_price_columns: [],
        }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const callAI = async (text: string, url: string, key: string, mdl: string, isXai: boolean) => {
      return await fetch(url, {
        method: "POST",
        headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: mdl,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: text },
          ],
          temperature: 0.1,
          ...(isXai ? { response_format: { type: "json_object" } } : {}),
        }),
      });
    };

    const processChunk = async (chunkText: string, chunkIdx: number): Promise<{ cols: string[]; products: ParsedProduct[] }> => {
      const t0 = Date.now();
      let apiUrl: string, apiKey: string, model: string, useXai: boolean;

      // xAI key is currently returning 403 — skip it and go straight to Lovable AI for speed.
      // This avoids wasting time on a guaranteed-failed request before falling back.
      if (lovableApiKey) {
        apiUrl = "https://ai.gateway.lovable.dev/v1/chat/completions";
        apiKey = lovableApiKey;
        model = "google/gemini-2.5-flash";
        useXai = false;
      } else {
        apiUrl = "https://api.x.ai/v1/chat/completions";
        apiKey = xaiApiKey!;
        model = "grok-3-fast";
        useXai = true;
      }

      let resp = await callAI(chunkText, apiUrl, apiKey, model, useXai);

      // Retry once with a different model if first attempt fails
      if (!resp.ok && lovableApiKey) {
        console.warn(`[Grok] Chunk ${chunkIdx}: first fallback failed (${resp.status}), retrying with gemini-2.5-pro`);
        await resp.text(); // consume body
        resp = await callAI(chunkText, "https://ai.gateway.lovable.dev/v1/chat/completions", lovableApiKey, "google/gemini-2.5-pro", false);
      }

      if (!resp.ok) {
        const errText = await resp.text();
        console.error(`[Grok] Chunk ${chunkIdx} failed after all retries:`, resp.status, errText.substring(0, 300));
        return { cols: [], products: [] };
      }

      let data: any;
      let rawText: string;
      try {
        rawText = await resp.text();
        data = JSON.parse(rawText);
      } catch (parseErr) {
        console.warn(`[Grok] Chunk ${chunkIdx}: JSON parse failed (${(parseErr as Error).message}), retrying with gemini-2.5-pro`);
        // Retry with a more capable model that produces complete JSON
        if (lovableApiKey) {
          try {
            const retryResp = await callAI(chunkText, "https://ai.gateway.lovable.dev/v1/chat/completions", lovableApiKey!, "google/gemini-2.5-pro", false);
            if (retryResp.ok) {
              const retryText = await retryResp.text();
              data = JSON.parse(retryText);
              console.log(`[Grok] Chunk ${chunkIdx}: retry with gemini-2.5-pro succeeded`);
            } else {
              await retryResp.text();
              console.error(`[Grok] Chunk ${chunkIdx}: retry HTTP failed (${retryResp.status})`);
              return { cols: [], products: [] };
            }
          } catch (retryErr) {
            console.error(`[Grok] Chunk ${chunkIdx}: retry also failed:`, (retryErr as Error).message);
            return { cols: [], products: [] };
          }
        } else {
          return { cols: [], products: [] };
        }
      }
      const content = data.choices?.[0]?.message?.content || "";
      const result = parseAIContent(content);
      console.log(`[Grok] Chunk ${chunkIdx}: ${result.products.length} products in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return { cols: result.detected_price_columns, products: result.products };
    };

    const result = await processChunk(truncatedText, chunkIndex);

    // Deduplicate only truly identical rows: same SKU, same price, same page, within 2% y-position
    const seen: Array<{ sku: string; price: number; page: number; yBucket: number }> = [];
    const deduped = result.products.filter((p) => {
      const sku = (p.sku || "").toLowerCase();
      if (!sku) return true; // keep products without SKU
      const bestPrice = pickBestPrice(p.prices || {}).price;
      const page = p.pageNumber || 0;
      // Bucket y-position to nearest 2% so only rows at nearly the same vertical position dedup
      const yPct = p.rowBbox?.y ?? -1;
      const yBucket = yPct >= 0 ? Math.round(yPct * 50) : -1; // 50 buckets = 2% each

      const isDupe = seen.some(
        (s) => s.sku === sku && s.price === bestPrice && s.page === page && (yBucket < 0 || s.yBucket < 0 || Math.abs(s.yBucket - yBucket) <= 1)
      );
      if (isDupe) {
        console.log(`[Grok] Dedup: skipping true duplicate "${sku}" (page: ${page}, y: ${yPct?.toFixed(3)})`);
        return false;
      }
      seen.push({ sku, price: bestPrice, page, yBucket });
      return true;
    });

    // Validate products — strict post-processing
    const HEADER_PATTERNS = /\b(VALID\s+FROM|PRICELIST|PRICE\s*LIST|EFFECTIVE\s+DATE)\b/i;
    const YEAR_PATTERN = /\b(202[3-9]|203[0-9])\b/;

    const validated = deduped.filter((p) => {
      const code = (p.sku || "").trim();
      if (code.length < SHARED_MIN_CODE_LEN) {
        console.warn(`[Grok] Reject short code: "${code}"`);
        return false;
      }
      const bestP = pickBestPrice(p.prices || {});
      if (!bestP.price || !Number.isFinite(bestP.price) || bestP.price < SHARED_MIN_PRICE || bestP.price > SHARED_MAX_PRICE) {
        console.warn(`[Grok] Reject "${code}" invalid/out-of-range price: ${bestP.price}`);
        return false;
      }
      // Reject document header/date rows mistakenly extracted as products
      const fullText = `${p.name || ""} ${p.description || ""} ${code}`;
      if (HEADER_PATTERNS.test(fullText)) {
        console.warn(`[Grok] Reject header row: "${code}" — "${fullText.substring(0, 80)}"`);
        return false;
      }
      if (YEAR_PATTERN.test(code) && code.length < 8) {
        console.warn(`[Grok] Reject year-like code: "${code}"`);
        return false;
      }
      return true;
    });

    const allCols = new Set<string>(result.cols || []);
    for (const p of deduped) {
      if (p.prices) for (const k of Object.keys(p.prices)) allCols.add(k);
    }

    if (validated.length === 0) {
      return new Response(
        JSON.stringify({ error: "Could not parse products.", products: [], detected_price_columns: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[Grok] Products:", validated.length, `(${deduped.length - validated.length} filtered)`, `chunk ${chunkIndex + 1}/${chunkTotal}`);

    return new Response(
      JSON.stringify({
        success: true,
        detected_price_columns: [...allCols],
        products: validated.map(p => {
          const bestPrice = pickBestPrice(p.prices || {});
          const costPrice = bestPrice.price;
          const soldInLength = p.soldInLength || false;
          const unitLength = p.unitLength || null;
          const pricePerMetre = soldInLength && unitLength && costPrice > 0
            ? Math.round((costPrice / unitLength) * 100) / 100
            : (p.pricePerMetre || null);
          return {
            product_code: p.sku || "",
            description: p.name ? `${p.name} - ${p.description}` : p.description || "",
            category: p.category || "Uncategorized",
            prices: p.prices || {},
            cost_price: costPrice,
            selected_price_column: bestPrice.columnName,
            price_is_incl_vat: bestPrice.isInclVat,
            pipe_size: p.pipeSize || null,
            btu_rating: p.btuRating || null,
            refrigerant_type: p.refrigerantType || null,
            is_price_on_request: !Object.values(p.prices || {}).some(v => v > 0),
            short_name: p.shortName || null,
            sold_in_length: soldInLength,
            unit_length: unitLength,
            unit_length_unit: p.unitLengthUnit || "m",
            price_per_metre: pricePerMetre,
            min_cut_length: p.minCutLength || 0.5,
            product_category: SHARED_VALID_CATEGORIES.includes(p.productCategory || "") ? p.productCategory : autoDetectCategory(p),
            brand: p.brand || autoDetectBrand(p),
            phase: p.phase || null,
            speed_type: p.speedType || null,
            kw: p.kw || null,
            unit_type: p.unitType || null,
            page_number: p.pageNumber || null,
            row_bbox: p.rowBbox || null,
            price_bbox: p.priceBbox || null,
          };
        }),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[Grok] Error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
