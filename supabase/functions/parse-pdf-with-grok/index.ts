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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { extracted_text, supplier_id, supplier_name, markup_percent } = await req.json();

    console.log("[Grok] Request received:", { 
      textLength: extracted_text?.length, 
      supplier_id, 
      supplier_name 
    });

    if (!extracted_text || !supplier_id) {
      return new Response(JSON.stringify({ error: "extracted_text and supplier_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const xaiApiKey = Deno.env.get("XAI_API_KEY");
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    
    console.log("[Grok] API keys available:", { 
      hasXaiKey: !!xaiApiKey, 
      hasLovableKey: !!lovableApiKey 
    });

    let apiUrl: string;
    let apiKey: string | undefined;
    let model: string;
    let useXai = false;

    if (xaiApiKey) {
      apiUrl = "https://api.x.ai/v1/chat/completions";
      apiKey = xaiApiKey;
      model = "grok-3-fast";
      useXai = true;
    } else if (lovableApiKey) {
      apiUrl = "https://ai.gateway.lovable.dev/v1/chat/completions";
      apiKey = lovableApiKey;
      model = "google/gemini-2.5-flash";
    } else {
      return new Response(JSON.stringify({ error: "No API key configured (XAI_API_KEY or LOVABLE_API_KEY)" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You are an expert HVAC supplier price list parser. Extract product data from the provided text into structured JSON.

IMPORTANT: Price lists often have MULTIPLE price columns. You MUST extract ALL price columns you find for each product.

Return ONLY a JSON object with:
- "detected_price_columns": array of strings describing the price columns found (e.g. ["Cost Excl VAT", "RRP Incl VAT", "Nett Price", "List Price"])
- "products": array of product objects

Each product object must have:
- sku: string (product/model code)
- name: string (short product name)
- description: string (full description including specs)
- category: string (e.g. "Midwall Inverter", "Cassette Inverter", "Ducted", "Floor Standing", "Portable", "Accessories")
- prices: object mapping each detected price column name to its numeric value. Use the EXACT same keys as in detected_price_columns. Example: {"Cost Excl VAT": 7700, "RRP Incl VAT": 12500}
- pipeSize: string or null (pipe sizes like "1/4 x 3/8")
- btuRating: number or null (BTU rating, e.g. 9000, 12000, 18000, 24000)
- refrigerantType: string or null (e.g. "R32", "R410A")
- shortName: string (concise display name: BRAND + BTU/kW + TYPE_ABBREV + SUBTYPE)
  Abbreviation rules:
  - Midwall Split Inverter → "INV MW" (e.g. "MIDEA 9K INV MW")
  - Midwall Split Fixed Speed → "FS MW"
  - Ducted Inverter → "INV DUCT"
  - Ducted Fixed Speed → "FS DUCT"
  - Cassette → "CASS"
  - Under Ceiling → "UC"
  - Window Wall → "WW"
  - Portable → "PORT"
  - Floor Standing → "FS FLOOR"
  - Multi Split → "MULTI"
  - VRF → "VRF"
  Variant suffixes: Breezeless → "BRZ", Xtreme → "XTR", Aurora → "AUR", Ultimate → "ULT"

Rules:
- Parse South African Rand prices: "R 7 700,00" = 7700.00, "R 12,500.00" = 12500.00
- Detect BTU/kW from descriptions: "9000 BTU", "2.6kW" → 9000 BTU
- Look for price column headers like "Cost", "Dealer Price", "Nett", "RRP", "Retail", "List Price", "Incl VAT", "Excl VAT"
- If only ONE price column exists, name it "Unit Price"
- Skip header rows, totals, and non-product text
- Supplier: ${supplier_name || "Unknown HVAC supplier"}

Return: {"detected_price_columns": [...], "products": [...]}`;

    const truncatedText = extracted_text.substring(0, 60000);
    console.log("[Grok] Sending text to AI, truncated length:", truncatedText.length);

    const callAI = async (url: string, key: string, mdl: string, isXai: boolean) => {
      console.log(`[Grok] Calling ${isXai ? 'xAI' : 'Lovable AI'} with model: ${mdl}`);
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: mdl,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: truncatedText },
          ],
          temperature: 0.1,
          ...(isXai ? { response_format: { type: "json_object" } } : {}),
        }),
      });
      return resp;
    };

    let aiResponse = await callAI(apiUrl, apiKey!, model, useXai);

    if (!aiResponse.ok && useXai && lovableApiKey) {
      const errText = await aiResponse.text();
      console.warn("[Grok] xAI failed, falling back to Lovable AI:", aiResponse.status, errText.substring(0, 500));
      apiUrl = "https://ai.gateway.lovable.dev/v1/chat/completions";
      apiKey = lovableApiKey;
      model = "google/gemini-2.5-flash";
      useXai = false;
      aiResponse = await callAI(apiUrl, apiKey, model, false);
    }

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("[Grok] AI API error (final):", aiResponse.status, errText.substring(0, 500));
      return new Response(JSON.stringify({ error: `AI parsing failed (${aiResponse.status}). Please try again.` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[Grok] AI response received successfully");

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content || "";

    let parsed: any = {};
    try {
      parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, "").trim());
    } catch {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { parsed = JSON.parse(jsonMatch[0]); } catch { /* skip */ }
      }
    }

    const detectedPriceColumns: string[] = parsed.detected_price_columns || [];
    let products: ParsedProduct[] = parsed.products || [];
    
    // Backward compat: if products have unitCost instead of prices object
    products = products.map(p => {
      if (!p.prices && (p as any).unitCost !== undefined) {
        return { ...p, prices: { "Unit Price": (p as any).unitCost } };
      }
      return p;
    });

    if (!Array.isArray(products) || products.length === 0) {
      return new Response(
        JSON.stringify({ error: "Could not parse products from the provided text.", products: [], detected_price_columns: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Ensure detected_price_columns includes all keys found in products
    const allPriceKeys = new Set(detectedPriceColumns);
    for (const p of products) {
      if (p.prices) {
        for (const k of Object.keys(p.prices)) allPriceKeys.add(k);
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        detected_price_columns: [...allPriceKeys],
        products: products.map(p => ({
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
    console.error("[Grok] Parse error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
