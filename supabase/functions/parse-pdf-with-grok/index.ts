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

    // Try xAI first, fallback to Lovable AI
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

    // Truncate text to avoid token limits
    const truncatedText = extracted_text.substring(0, 60000);
    console.log("[Grok] Sending text to AI, truncated length:", truncatedText.length);

    // Helper to call an AI API
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

    let aiResponse = await callAI(apiUrl, apiKey, model, useXai);

    // If xAI fails (403 = no credits, or other errors), fallback to Lovable AI
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
