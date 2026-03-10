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

const SYSTEM_PROMPT = `You are a strict HVAC price list parser. Your job is to extract ONLY product rows that have a valid price in the NETT/COST price column.

CRITICAL RULES:
1. Extract ONLY rows that have a numeric price > 0 in the rightmost price column (typically "NETT PRICE", "COST", "EXCL VAT", or similar)
2. ONE region per product row — NEVER merge multiple product rows into one entry
3. SKIP all non-product content: headers, footers, page titles, images, blank lines, subtotals, category headers, section dividers
4. SKIP rows where the price is 0, empty, or "POA"/"Price on Request"
5. Every valid priced product row MUST be extracted — do not miss any
6. Each product must have a unique SKU/product_code — if two rows have the same code, they are separate entries (e.g. indoor + outdoor unit)

Return JSON: {"detected_price_columns":[...],"products":[...]}

Product fields:
- sku: string (the product/model code)
- name: string (product name/model)
- description: string (full description text from the row)
- category: string (subcategory like "Midwall Inverter", "Cassette", "Ducted", etc.)
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

SECTION HEADER DETECTION: Rows like "AR3000 Non-Inverter" or "Midwall Split Systems" with NO price are section headers — SKIP them entirely.

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

function pickBestPrice(prices: Record<string, number>): { price: number; columnName: string; isInclVat: boolean } {
  const entries = Object.entries(prices).filter(([, v]) => typeof v === "number" && v > 0);
  if (entries.length === 0) return { price: 0, columnName: "", isInclVat: false };
  if (entries.length === 1) {
    const [col, val] = entries[0];
    const upper = col.toUpperCase();
    const isIncl = /INCL|INC\b|INCLUDING/.test(upper) && !/EXCL/.test(upper);
    return { price: val, columnName: col, isInclVat: isIncl };
  }

  const exclPatterns = [/EXCL/i, /EX\s*VAT/i, /\bCOST\b/i, /\bNET\b/i, /DEALER/i, /TRADE/i];
  for (const pattern of exclPatterns) {
    const match = entries.find(([col]) => pattern.test(col));
    if (match) return { price: match[1], columnName: match[0], isInclVat: false };
  }

  const inclIdx = entries.findIndex(([col]) => /INCL|INC\b|INCLUDING/i.test(col.toUpperCase()));
  if (inclIdx !== -1 && entries.length > 1) {
    const exclEntry = entries.find((_, idx) => idx !== inclIdx);
    if (exclEntry) return { price: exclEntry[1], columnName: exclEntry[0], isInclVat: false };
  }

  entries.sort((a, b) => a[1] - b[1]);
  return { price: entries[0][1], columnName: entries[0][0], isInclVat: false };
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

      if (xaiApiKey) {
        apiUrl = "https://api.x.ai/v1/chat/completions";
        apiKey = xaiApiKey;
        model = "grok-3-fast";
        useXai = true;
      } else {
        apiUrl = "https://ai.gateway.lovable.dev/v1/chat/completions";
        apiKey = lovableApiKey!;
        model = "google/gemini-2.5-flash";
        useXai = false;
      }

      let resp = await callAI(chunkText, apiUrl, apiKey, model, useXai);

      if (!resp.ok && useXai && lovableApiKey) {
        console.warn(`[Grok] Chunk ${chunkIdx}: xAI failed (${resp.status}), falling back`);
        await resp.text(); // consume body
        resp = await callAI(chunkText, "https://ai.gateway.lovable.dev/v1/chat/completions", lovableApiKey, "google/gemini-2.5-flash", false);
      }

      if (!resp.ok) {
        const errText = await resp.text();
        console.error(`[Grok] Chunk ${chunkIdx} failed:`, resp.status, errText.substring(0, 300));
        return { cols: [], products: [] };
      }

      let data: any;
      try {
        const rawText = await resp.text();
        data = JSON.parse(rawText);
      } catch (parseErr) {
        console.error(`[Grok] Chunk ${chunkIdx}: Failed to parse response`, (parseErr as Error).message);
        return { cols: [], products: [] };
      }
      const content = data.choices?.[0]?.message?.content || "";
      const result = parseAIContent(content);
      console.log(`[Grok] Chunk ${chunkIdx}: ${result.products.length} products in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return { cols: result.detected_price_columns, products: result.products };
    };

    const result = await processChunk(truncatedText, chunkIndex);

    // Deduplicate by SKU within chunk
    const seen = new Set<string>();
    const deduped = result.products.filter((p) => {
      const key = (p.sku || "").toLowerCase();
      if (!key || seen.has(key)) return !key ? true : false;
      seen.add(key);
      return true;
    });

    // Validate products
    const validated = deduped.filter((p) => {
      const code = (p.sku || "").trim();
      if (code.length < SHARED_MIN_CODE_LEN) {
        console.warn(`[Grok] Skipping short code: "${code}"`);
        return false;
      }
      const bestP = pickBestPrice(p.prices || {});
      if (bestP.price < SHARED_MIN_PRICE || bestP.price > SHARED_MAX_PRICE) {
        console.warn(`[Grok] Skipping "${code}" out-of-range price: ${bestP.price}`);
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
            page_number: p.pageNumber ?? null,
            row_bbox: p.rowBbox ?? null,
            price_bbox: p.priceBbox ?? null,
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
