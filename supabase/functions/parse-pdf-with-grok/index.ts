const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
}

const CHUNK_SIZE = 12000;
const MAX_TEXT = 250000;

const SYSTEM_PROMPT_TEMPLATE = `HVAC price list parser. Extract products as JSON.

Return: {"detected_price_columns":[...],"products":[...]}

Product fields: sku, name, description, category, prices (object: column→number), pipeSize, btuRating, refrigerantType, shortName.

Categories: Midwall Inverter, Midwall Fixed Speed, Cassette Inverter, Cassette Fixed Speed, Ducted, Under Ceiling, Floor Standing, Wind-Free, BREEZELESS, Portable, Accessories, etc.
Samsung AC models typically start with AR (e.g. AR09TXHQA, AR12TXHQA, AR18TXHQA, AR24TXHQA) for indoor units and AR for outdoor units. Look for Samsung Wind-Free, BREEZELESS, Digital Inverter product lines. These have BTU ratings of 9000, 12000, 18000, 24000 BTU. Also detect kW values like 2.6kW=9K, 3.5kW=12K, 5.0kW=18K, 7.0kW=24K and convert to BTU.
shortName format: BRAND BTU/kW ABBREV. Abbrevs: INV MW, FS MW, INV DUCT, FS DUCT, CASS, UC, WW, PORT, FS FLOOR, MULTI, VRF. Suffixes: BRZ, XTR, AUR, ULT.
Prices: ZAR format "R 7 700,00"=7700. Detect BTU from "9000 BTU"/"2.6kW". Multiple price columns→use all. Single→"Unit Price".
Skip headers/totals. Supplier: `;

function splitIntoChunks(text: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + chunkSize, text.length);
    // Try to break at a newline to avoid splitting a product row
    if (end < text.length) {
      const lastNewline = text.lastIndexOf("\n", end);
      if (lastNewline > i + chunkSize * 0.5) end = lastNewline + 1;
    }
    chunks.push(text.substring(i, end));
    i = end;
  }
  return chunks;
}

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { extracted_text, supplier_id, supplier_name, chunk_index, chunk_total } = await req.json();
    const chunkIndex = Number.isFinite(Number(chunk_index)) ? Number(chunk_index) : 0;
    const chunkTotal = Number.isFinite(Number(chunk_total)) ? Number(chunk_total) : 1;

    console.log("[Grok] Request:", {
      textLength: extracted_text?.length,
      supplier_id,
      chunkIndex,
      chunkTotal,
    });

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

    const systemPrompt = SYSTEM_PROMPT_TEMPLATE + (supplier_name || "Unknown");
    const truncatedText = extracted_text.substring(0, MAX_TEXT);

    // IMPORTANT: this function is intentionally single-chunk to stay under the backend wall-clock limit.
    // The client is responsible for splitting long PDFs into <= CHUNK_SIZE chunks and calling this
    // function multiple times.
    if (truncatedText.length > CHUNK_SIZE) {
      return new Response(
        JSON.stringify({
          error: `Chunk too large (${truncatedText.length} chars). Split the text into <= ${CHUNK_SIZE} char chunks and retry.`,
          products: [],
          detected_price_columns: [],
        }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const callAI = async (text: string, url: string, key: string, mdl: string, isXai: boolean) => {
      const resp = await fetch(url, {
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
      return resp;
    };

    const processChunk = async (chunkText: string, chunkIndexForLogs: number): Promise<{ cols: string[]; products: ParsedProduct[] }> => {
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

      // Fallback to Lovable AI if xAI fails
      if (!resp.ok && useXai && lovableApiKey) {
        const errText = await resp.text();
        console.warn(`[Grok] Chunk ${chunkIndexForLogs}: xAI failed (${resp.status}), falling back`);
        resp = await callAI(
          chunkText,
          "https://ai.gateway.lovable.dev/v1/chat/completions",
          lovableApiKey,
          "google/gemini-2.5-flash",
          false
        );
      }

      if (!resp.ok) {
        const errText = await resp.text();
        console.error(`[Grok] Chunk ${chunkIndexForLogs} failed:`, resp.status, errText.substring(0, 300));
        return { cols: [], products: [] };
      }

      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content || "";
      const result = parseAIContent(content);
      const durationS = (Date.now() - t0) / 1000;
      console.log(`[Grok] Chunk ${chunkIndexForLogs}: ${result.products.length} products in ${durationS.toFixed(1)}s`);
      return { cols: result.detected_price_columns, products: result.products };
    };

    // Process a single chunk per request.
    const result = await processChunk(truncatedText, chunkIndex);

    // Deduplicate by SKU within this chunk (keep first occurrence)
    const seen = new Set<string>();
    const deduped = result.products.filter((p) => {
      const key = (p.sku || "").toLowerCase();
      if (!key || seen.has(key)) return !key ? true : false;
      seen.add(key);
      return true;
    });

    const allCols = new Set<string>(result.cols || []);
    for (const p of deduped) {
      if (p.prices) for (const k of Object.keys(p.prices)) allCols.add(k);
    }

    if (deduped.length === 0) {
      return new Response(
        JSON.stringify({ error: "Could not parse products.", products: [], detected_price_columns: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[Grok] Products:", deduped.length, `chunk ${chunkIndex + 1}/${chunkTotal}`);

    return new Response(
      JSON.stringify({
        success: true,
        detected_price_columns: [...allCols],
        products: deduped.map(p => ({
          product_code: p.sku || "",
          description: p.name ? `${p.name} - ${p.description}` : p.description || "",
          category: p.category || "Uncategorized",
          prices: p.prices || {},
          cost_price: Object.values(p.prices || {})[0] || 0,
          pipe_size: p.pipeSize || null,
          btu_rating: p.btuRating || null,
          refrigerant_type: p.refrigerantType || null,
          is_price_on_request: !Object.values(p.prices || {}).some(v => v > 0),
          short_name: p.shortName || null,
        })),
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
