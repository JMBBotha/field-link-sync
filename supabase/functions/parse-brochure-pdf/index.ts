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

    const systemPrompt = `You are an HVAC expert. Analyze this brochure PDF. Extract:

- brand: Exactly one of Samsung, Alliance, or Comfee. Look at logos carefully - Alliance is NOT Samsung. If unsure default to Samsung.
- product_name: Clean marketing name e.g. 'AR6500 WindFree', 'AR80 Series', 'Alliance Emerald R32'
- category: One of Residential Wall-Mount, Commercial Wall-Mount, Commercial Cassette, Commercial Ducted, Commercial Underceiling. Default to "Residential Wall-Mount" if unsure.
- candidate_model_snippets: EVERY model code or prefix found in the PDF. These are alphanumeric codes like AR09BSHC, AR12BSHC, AC026RN1D, FOUS09, FOUSI12-R32, FCMI-09. Search spec tables, model comparison charts, ordering info, footnotes. Return 5-15 entries. Each BTU/kW size variant has its own model number - list them ALL. NEVER return empty array.`;

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
                  text: "Analyze this HVAC product brochure PDF. Extract brand, product name, category, and ALL model codes/numbers found anywhere in the document. Return 5-15 candidate_model_snippets.",
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
                        "Clean marketing product name",
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
                    candidate_model_snippets: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "Array of 5-15 model codes/numbers found in the brochure. These are hints for matching to real products in the database.",
                    },
                  },
                  required: [
                    "brand",
                    "product_name",
                    "category",
                    "candidate_model_snippets",
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

    // Normalize snippets
    parsed.candidate_model_snippets = (parsed.candidate_model_snippets || []).map(
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
