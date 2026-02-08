import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { jobType, siteNotes } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get historical quote data
    const { data: pastItems } = await supabase.rpc("past_quote_analytics", {
      p_job_type: jobType || null,
    });

    const historicalContext = pastItems?.length
      ? `Historical line items from ${pastItems.length} similar past quotes:\n${pastItems
          .map(
            (item: any) =>
              `- "${item.description}": avg price R${item.avg_unit_price}, used ${item.usage_count} times, avg qty ${item.avg_quantity}`
          )
          .join("\n")}`
      : "No historical quote data available yet.";

    const prompt = `You are an HVAC quoting assistant for a South African company (AC Super Service). Generate suggested line items for a quote.

Job Type: ${jobType || "General HVAC"}
Site Notes: ${siteNotes || "None provided"}

${historicalContext}

Based on this information, suggest 3-6 appropriate line items. Return a JSON array using this tool.
Prices should be in ZAR (South African Rand). Use realistic HVAC pricing for the South African market.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "You are an HVAC quoting expert for South Africa. Always respond with structured tool calls." },
          { role: "user", content: prompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "suggest_line_items",
              description: "Return suggested quote line items",
              parameters: {
                type: "object",
                properties: {
                  suggestions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        description: { type: "string" },
                        quantity: { type: "number" },
                        unit_price: { type: "number" },
                        reasoning: { type: "string" },
                      },
                      required: ["description", "quantity", "unit_price"],
                      additionalProperties: false,
                    },
                  },
                  similar_quotes_count: { type: "number" },
                },
                required: ["suggestions", "similar_quotes_count"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "suggest_line_items" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await response.text();
      console.error("AI error:", response.status, errText);
      throw new Error("AI gateway error");
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    let suggestions = { suggestions: [], similar_quotes_count: pastItems?.length || 0 };

    if (toolCall?.function?.arguments) {
      try {
        suggestions = JSON.parse(toolCall.function.arguments);
        suggestions.similar_quotes_count = pastItems?.length || 0;
      } catch {
        console.error("Failed to parse AI response");
      }
    }

    return new Response(JSON.stringify(suggestions), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-suggest-quote error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
