import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ParsedProduct {
  sku: string;
  name: string;
  description: string;
  category: string;
  unitCost: number;
  pipeSize?: string | null;
  btuRating?: number | null;
  refrigerantType?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { extracted_text, supplier_id, supplier_name, markup_percent } = await req.json();

    if (!extracted_text || !supplier_id) {
      return new Response(JSON.stringify({ error: "extracted_text and supplier_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const xaiApiKey = Deno.env.get("XAI_API_KEY");
    
    // Fallback to Lovable AI if no xAI key
    const apiUrl = xaiApiKey 
      ? "https://api.x.ai/v1/chat/completions"
      : "https://ai.gateway.lovable.dev/v1/chat/completions";
    
    const apiKey = xaiApiKey || Deno.env.get("LOVABLE_API_KEY");
    const model = xaiApiKey ? "grok-3-fast" : "google/gemini-2.5-flash";

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "No API key configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You are an expert HVAC supplier price list parser. Extract product data from the provided text into structured JSON.

Return ONLY a JSON object with a "products" array. Each product object must have:
- sku: string (product/model code, e.g. "BZE-INV-09", "MSM-12HRDN1")
- name: string (short product name)
- description: string (full description including specs)
- category: string (e.g. "Midwall Inverter", "Cassette Inverter", "Ducted", "Floor Standing", "Portable", "Accessories")
- unitCost: number (price as a number, parse "R 7 700,00" or "R7700.00" as 7700.00, use 0 if not found)
- pipeSize: string or null (pipe sizes like "1/4 x 3/8")
- btuRating: number or null (BTU rating, e.g. 9000, 12000, 18000, 24000)
- refrigerantType: string or null (e.g. "R32", "R410A")

Rules:
- Parse South African Rand prices: "R 7 700,00" = 7700.00, "R 12,500.00" = 12500.00
- Detect BTU/kW from descriptions: "9000 BTU", "2.6kW" → 9000 BTU
- Identify product categories from context headers and descriptions
- Skip header rows, totals, and non-product text
- Supplier: ${supplier_name || "Unknown HVAC supplier"}

Return: {"products": [...]}`;

    // Truncate text to avoid token limits (roughly 60k chars ≈ 15k tokens)
    const truncatedText = extracted_text.substring(0, 60000);

    const aiResponse = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: truncatedText },
        ],
        temperature: 0.1,
        ...(xaiApiKey ? { response_format: { type: "json_object" } } : {}),
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("[Grok] API error:", aiResponse.status, errText);
      return new Response(JSON.stringify({ error: `AI API error: ${aiResponse.status}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content || "";

    let products: ParsedProduct[] = [];
    try {
      // Try parsing as JSON object with "products" key
      const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, "").trim());
      products = parsed.products || parsed;
    } catch {
      // Try extracting JSON array
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try { products = JSON.parse(jsonMatch[0]); } catch { /* skip */ }
      }
    }

    if (!Array.isArray(products) || products.length === 0) {
      return new Response(
        JSON.stringify({ error: "Could not parse products from the provided text.", products: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Return parsed products for preview (don't import yet)
    return new Response(
      JSON.stringify({ 
        success: true, 
        products: products.map(p => ({
          product_code: p.sku || "",
          description: p.name ? `${p.name} - ${p.description}` : p.description || "",
          category: p.category || "Uncategorized",
          cost_price: typeof p.unitCost === "number" ? p.unitCost : 0,
          pipe_size: p.pipeSize || null,
          btu_rating: p.btuRating || null,
          refrigerant_type: p.refrigerantType || null,
          is_price_on_request: !p.unitCost || p.unitCost <= 0,
        })),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[Grok] Parse error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
