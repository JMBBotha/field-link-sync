/**
 * mandy-quote-plan — Mandy quote mode (in-app only). xAI Grok turns a spoken
 * job description into a structured plan. It never sees prices and never
 * writes data: the browser resolves every item through the shared catalog
 * matcher and writes only after the user taps Confirm.
 *
 * xAI only (XAI_API_KEY). Not used by phone Mandy / Vapi.
 */
import { requireUser, authCorsHeaders } from "../_shared/auth.ts";

const cors = authCorsHeaders;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MODEL = Deno.env.get("XAI_CHAT_MODEL") || "grok-4.20-0309-non-reasoning";

const SYSTEM = `You turn a South African air-conditioning installer's spoken job description into a quote plan.
Return ONLY a JSON object: {"client": string|null, "items": [{"query": string, "qty": number|null, "length_m": number|null, "area": string|null, "kind": "unit"|"piping"|"labour"|"item"}]}.
Rules:
- One item per thing to quote. "query" is the product words as spoken, cleaned (brand, BTU like "18K", model like "AR40", product like "trunking", "drain pipe", "elbow", "bracket").
- kind "unit" for air-conditioner units, "piping" for copper piping / piping kit (put metres in length_m), "labour" for labour (hours in qty), otherwise "item".
- qty = count (e.g. "2 trunking lengths" → query "trunking", qty 2). Spoken numbers become digits; "a couple" = 2; "bends" = elbows.
- length_m only for metres (e.g. "5 m piping" → kind piping, length_m 5; "5 metre drain pipe" → query "drain pipe", length_m 5).
- area = room name when said ("main bedroom", "lounge"); carry it forward to following items until another room is named; null if none said.
- client = the client's name if the speaker names one, else null.
- Never invent products, prices, rooms or quantities that were not said.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const key = Deno.env.get("XAI_API_KEY");
  if (!key) return json({ error: "Mandy is not configured — add the secret XAI_API_KEY." }, 500);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid request body." }, 400); }
  const transcript = String(body.transcript ?? "").trim().slice(0, 3000);
  if (!transcript) return json({ error: "No transcript." }, 400);
  const areas = Array.isArray(body.areas) ? (body.areas as unknown[]).map(String).slice(0, 20) : [];

  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Existing areas on this quote: ${areas.join(", ") || "none"}.\nSpoken: ${transcript}` },
      ],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return json({ error: `Mandy's brain returned ${res.status}. ${detail.slice(0, 200)}` }, res.status === 429 ? 429 : 502);
  }
  const data = await res.json();
  const content = String(data?.choices?.[0]?.message?.content ?? "{}");
  let plan: unknown = {};
  try { plan = JSON.parse(content); } catch {
    const m = content.match(/\{[\s\S]*\}/);
    try { plan = m ? JSON.parse(m[0]) : {}; } catch { plan = {}; }
  }
  return json({ plan, model: MODEL });
});
