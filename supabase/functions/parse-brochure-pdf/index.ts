import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const { pdfBase64 } = await req.json();
    if (!pdfBase64) {
      return new Response(JSON.stringify({ error: "pdfBase64 is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const systemPrompt = `You are an HVAC product expert. Analyze this product brochure PDF and extract structured information using the extract_brochure_info tool.

CRITICAL RULES:
- brand MUST be exactly one of: Samsung, Alliance, Comfee
- category MUST be exactly one of: Residential Wall-Mount, Commercial Wall-Mount, Commercial Cassette, Commercial Ducted, Commercial Underceiling. If unsure, default to "Residential Wall-Mount".
- product_name should be a clean marketing name like "Samsung AR9500 2.0 WindFree"
- model_match_prefixes: Extract ALL model numbers, part numbers, and SKU codes found ANYWHERE in the document. HVAC brochures list multiple BTU/kW sizes on ONE brochure. Look for alphanumeric codes following patterns like XX00XXXX (e.g. AR09BSHC, AR12BSHC, AR18BSHC, AR24BSHC, AC026TNXD, FOUS09, FOUSI12-R32). Each size variant is a separate prefix. Return ALL unique model number prefixes found as uppercase strings. One brochure = one product family covering multiple capacities.
- Search specification tables, model comparison charts, ordering information, and footnotes for model codes
- Return at minimum 1 model prefix. If you find full model numbers like AR09BSHCAWKNFA, use the significant prefix portion (e.g. AR09BSHC)`;

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: {
                    url: `data:application/pdf;base64,${pdfBase64}`,
                  },
                },
                {
                  type: "text",
                  text: "Analyze this HVAC product brochure PDF. Extract the brand, product name, category, and ALL model number prefixes. Look carefully in spec tables, model comparison charts, and ordering info for alphanumeric model codes. Each BTU/kW size variant has its own model number - list them ALL.",
                },
              ],
            },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "extract_brochure_info",
                description:
                  "Extract structured brochure information from an HVAC product PDF",
                parameters: {
                  type: "object",
                  properties: {
                    brand: {
                      type: "string",
                      enum: ["Samsung", "Alliance", "Comfee"],
                      description: "The brand of the product",
                    },
                    product_name: {
                      type: "string",
                      description:
                        "Clean marketing product name, e.g. 'Samsung AR9500 2.0 WindFree'",
                    },
                    category: {
                      type: "string",
                      enum: [
                        "Residential Wall-Mount",
                        "Commercial Wall-Mount",
                        "Commercial Cassette",
                        "Commercial Ducted",
                        "Commercial Underceiling",
                      ],
                      description: "Product category",
                    },
                    model_match_prefixes: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "Array of uppercase model code prefixes found in the brochure",
                    },
                  },
                  required: [
                    "brand",
                    "product_name",
                    "category",
                    "model_match_prefixes",
                  ],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: "extract_brochure_info" },
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);

      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limited, please try again later" }),
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Credits exhausted" }),
          {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      return new Response(
        JSON.stringify({ error: "AI analysis failed" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall?.function?.arguments) {
      console.error("No tool call in response:", JSON.stringify(aiResult));
      return new Response(
        JSON.stringify({ error: "AI did not return structured data" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const parsed = JSON.parse(toolCall.function.arguments);

    // Normalize prefixes
    parsed.model_match_prefixes = (parsed.model_match_prefixes || []).map(
      (p: string) => p.trim().toUpperCase()
    ).filter(Boolean);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("parse-brochure-pdf error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
