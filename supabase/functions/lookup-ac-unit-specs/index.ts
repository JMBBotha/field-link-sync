import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// This looks up REAL external specs for a unit that isn't fully in our own catalog yet
// (only a model number / partial description was typed), so it needs live web knowledge —
// unlike generate-product-description, which only rephrases our own known DB fields.
const XAI_MODEL = "grok-4";

const SYSTEM_PROMPT = `You are an HVAC product research assistant. Given an air conditioning / HVAC unit's model number or partial description, use web search to find its real published specifications (from manufacturer spec sheets, retailer listings, or brochures) and write a short (2-4 sentence, under 60 words), factual, information-rich summary suitable for a sales quote line item.

Rules:
- Only state facts you actually found via search. If you cannot find reliable information for the given model, say so plainly instead of guessing or inventing specs.
- Prioritise: capacity (BTU/kW), energy efficiency / inverter technology, ideal room size, and any standout feature, if found.
- Do not use markdown, headings or bullet points — plain prose only.
- Do not mention the word "AI" or "search". Do not use exclamation marks.`;

async function callResponsesApi(apiKey: string, query: string) {
  const res = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: XAI_MODEL,
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Look up this AC/HVAC unit and summarize its real specs: ${query}` },
      ],
      tools: [{ type: "web_search" }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Responses API ${res.status}: ${text}`);
  }
  const data = await res.json();
  // Responses API returns output as an array of items; find the text content.
  const outputText =
    data.output_text ??
    data.output?.flatMap((item: any) => item.content ?? []).find((c: any) => c.type === "output_text")?.text ??
    data.output?.[0]?.content?.[0]?.text;
  return { text: outputText as string | undefined, citations: data.citations ?? null };
}

async function callChatCompletionsLegacyFallback(apiKey: string, query: string) {
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "grok-3-latest",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Look up this AC/HVAC unit and summarize its real specs: ${query}` },
      ],
      search_parameters: { mode: "on", return_citations: true, sources: [{ type: "web" }] },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Chat completions ${res.status}: ${text}`);
  }
  const data = await res.json();
  return { text: data.choices?.[0]?.message?.content as string | undefined, citations: data.citations ?? null };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { query } = await req.json();
    if (!query || typeof query !== "string") {
      return new Response(JSON.stringify({ error: "query (model number or description) is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const XAI_API_KEY = Deno.env.get("XAI_API_KEY");
    if (!XAI_API_KEY) throw new Error("XAI_API_KEY not configured");

    // xAI's live-search API surface has changed over time (Responses API w/ web_search tool
    // is current at time of writing; legacy Chat Completions `search_parameters` is kept as
    // a fallback in case the Responses endpoint is unavailable on this account/model).
    let result;
    try {
      result = await callResponsesApi(XAI_API_KEY, query);
    } catch (primaryError) {
      console.error("Responses API web search failed, falling back to legacy search_parameters:", primaryError);
      result = await callChatCompletionsLegacyFallback(XAI_API_KEY, query);
    }

    if (!result.text) throw new Error("Model returned no text");

    return new Response(
      JSON.stringify({ description: result.text.trim(), citations: result.citations }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("lookup-ac-unit-specs error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
