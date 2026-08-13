import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Single easily-swappable model constant for the sales-description generator.
const AI_MODEL = "google/gemini-3-flash-preview";
const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

const SYSTEM_PROMPT = `You are a factual product copywriter for a South African HVAC/air-conditioning company. You write short, information-rich sales descriptions for air conditioning units and HVAC equipment to be used as line-item descriptions on customer quotes and estimates.

Rules:
- Use ONLY the facts given to you about the specific product. Never invent a spec (BTU, kW, SEER/efficiency rating, warranty length, etc.) that was not provided.
- If a spec is missing, write a good description from what is available — do not guess or fabricate the missing figure.
- Length: 2-4 sentences, no more than about 60 words. No headings, no bullet points, no markdown.
- Tone: persuasive but factual and professional — suitable for a formal customer-facing quote document, not a marketing blog post.
- Prioritise: capacity/room-size suitability, efficiency/inverter technology, brand reputation if notable, and a concrete selling point (quiet operation, running cost savings, reliability) — only if supported by the given facts.
- Do not mention price. Do not mention the word "AI". Do not use exclamation marks.`;

function buildUserPrompt(product: Record<string, unknown>) {
  const fields: string[] = [];
  const push = (label: string, value: unknown) => {
    if (value !== null && value !== undefined && value !== "") fields.push(`${label}: ${value}`);
  };
  push("Brand", product.brand);
  push("Model", product.model);
  push("Model range", product.model_range);
  push("Name", product.name);
  push("Existing description", product.description);
  push("Category", product.product_category || product.category);
  push("Subcategory", product.subcategory);
  push("Capacity (BTU)", product.capacity_btu || product.btu_rating);
  push("Capacity (kW)", product.kw);
  push("Phase", product.phase);
  push("Inverter", product.inverter === true ? "Yes" : product.inverter === false ? "No" : undefined);
  push("Refrigerant type", product.refrigerant_type);
  push("Product code", product.product_code);

  return `Write a short sales description for this air conditioning / HVAC product using only the facts below:\n\n${fields.join("\n")}\n\nReturn only the description text, nothing else.`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { productId, regenerate } = await req.json();
    if (!productId) {
      return new Response(JSON.stringify({ error: "productId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: product, error: fetchError } = await supabase
      .from("supplier_products")
      .select(
        "id, brand, model, model_range, name, description, category, product_category, subcategory, capacity_btu, btu_rating, kw, phase, inverter, refrigerant_type, product_code, ai_sales_description, ai_sales_description_generated_at"
      )
      .eq("id", productId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!product) {
      return new Response(JSON.stringify({ error: "Product not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cache hit: return immediately without calling the AI, unless regenerate was requested.
    if (!regenerate && product.ai_sales_description) {
      return new Response(
        JSON.stringify({
          description: product.ai_sales_description,
          generatedAt: product.ai_sales_description_generated_at,
          cached: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const aiResponse = await fetch(AI_GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(product) },
        ],
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errText);
      throw new Error("AI gateway error");
    }

    const aiResult = await aiResponse.json();
    const description: string | undefined = aiResult.choices?.[0]?.message?.content?.trim();

    if (!description) {
      throw new Error("AI returned an empty description");
    }

    const generatedAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("supplier_products")
      .update({ ai_sales_description: description, ai_sales_description_generated_at: generatedAt })
      .eq("id", productId);

    if (updateError) throw updateError;

    return new Response(
      JSON.stringify({ description, generatedAt, cached: false }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("generate-product-description error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
