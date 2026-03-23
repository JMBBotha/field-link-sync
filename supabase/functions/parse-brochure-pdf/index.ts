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

    const systemPrompt = `You are an expert Samsung HVAC technician. This is a 3-page product brochure for ONE product family.

Extract EXACTLY:
- brand (Samsung / Alliance / Comfee)
- product_name (clean marketing name, e.g. 'AR6500 WindFree', 'AR80 Series', 'Alliance Emerald R32')
- category (one of: Residential Wall-Mount, Commercial Wall-Mount, Commercial Cassette, Commercial Ducted, Commercial Underceiling. If unsure, default to "Residential Wall-Mount")
- model_match_prefixes (MOST IMPORTANT):
  * Scan EVERY model code in tables, specs, features, ordering info, or text
  * Extract 3-8 unique uppercase prefixes that would match quote line items
  * Look for alphanumeric codes following patterns like AR09BSHC, AC026TNXD, FOUS09, FOUSI12-R32
  * Each BTU/kW size variant has its own model number - list them ALL
  * If a series name appears (e.g. AR6500 WindFree), include both the series prefix (AR6500) and individual size variants (AR09, AR12, AR18, AR24)
  * ALWAYS return at least one prefix - never return empty array
  * HVAC brochures ALWAYS list multiple model variants in spec tables - FIND THEM
  * Search specification tables, model comparison charts, ordering information, and footnotes for model codes

Be aggressive - extract every model code you can find.`;

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
                  text: "Analyze this HVAC product brochure PDF. Extract the brand, product name, category, and ALL model number prefixes. Look carefully in spec tables, model comparison charts, and ordering info for alphanumeric model codes. Each BTU/kW size variant has its own model number - list them ALL. Return at least 1 prefix.",
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
                        "Clean marketing product name, e.g. 'AR6500 WindFree', 'AR80 Series'",
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
                        "Array of 3-8 uppercase model code prefixes found in the brochure. MUST contain at least 1 item.",
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
