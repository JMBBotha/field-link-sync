/**
 * voice-quote-parse — voice line-item capture for the unified quote builder.
 *
 * Actions:
 *   transcribe   base64 WAV -> transcript text (Lovable AI speech-to-text)
 *   parse        transcript -> structured draft line items + search terms
 *   audit        record the confirm/cancel decision in nl_audit_log
 *
 * This function NEVER writes quote rows. It only produces a draft that the
 * builder shows for review; saving goes through the existing single source of
 * truth (baskets -> persistQuoteFromBaskets -> quote_areas/quote_items).
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireUser, authCorsHeaders } from "../_shared/auth.ts";

const corsHeaders = authCorsHeaders;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const GATEWAY = "https://ai.gateway.lovable.dev/v1";

const PARSE_PROMPT =
  `You convert an HVAC contractor's spoken words into draft quote line items for a South African air-conditioning company.

Return ONLY JSON of the form:
{"items":[{"name":"","description":"","quantity":1,"unit":"each","search_terms":"","spoken_price":null,"kind":"equipment"}],"notes":""}

Rules:
- "unit" is one of: each, m, roll, day, hour, kg, box.
- Labour spoken as "install labour 2 days" -> unit "day", quantity 2, kind "labour".
- Lengths like "15 meters of ducting" -> unit "m", quantity 15, kind "material".
- "search_terms" is a short catalog search string (brand, capacity, product words) such as "Daikin 3 ton split" or "flexible ducting".
- Capacity phrasing must be preserved in name and search terms (3-ton, 12000 BTU, 9kW).
- Only set "spoken_price" when the speaker states a rand amount for that item; otherwise null.
- Never invent prices, product codes or brands that were not spoken.
- Ignore chatter that is not a line item; put anything ambiguous in "notes".`;

function pickJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("The assistant did not return usable line items.");
  return JSON.parse(text.slice(start, end + 1));
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const userId = auth.userId;

  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return json({ error: "AI is not configured (missing LOVABLE_API_KEY)." }, 500);

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const companyId = userId
    ? (await db.from("profiles").select("company_id").eq("id", userId).maybeSingle()).data?.company_id ?? null
    : null;

  try {
    const body = await req.json();
    const action = String(body?.action ?? "parse");

    // ---------------------------------------------------------------- audio
    if (action === "transcribe") {
      const bytes = base64ToBytes(String(body?.audio ?? ""));
      if (bytes.byteLength < 2048) {
        return json({ error: "That recording was empty — please try again." }, 400);
      }
      const form = new FormData();
      form.append("model", "openai/gpt-4o-transcribe");
      form.append("file", new Blob([bytes], { type: "audio/wav" }), "recording.wav");

      const res = await fetch(`${GATEWAY}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        return json({ error: `Transcription failed: ${res.status} ${detail}`.trim() }, res.status);
      }
      const out = await res.json();
      return json({ transcript: String(out?.text ?? "").trim() });
    }

    // ---------------------------------------------------------------- parse
    if (action === "parse") {
      const transcript = String(body?.transcript ?? "").trim();
      if (transcript.length < 3) return json({ error: "Nothing was said that could be turned into line items." }, 400);

      const res = await fetch(`${GATEWAY}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-3.6-flash",
          temperature: 0,
          messages: [
            { role: "system", content: PARSE_PROMPT },
            { role: "user", content: transcript },
          ],
        }),
      });
      if (res.status === 429) return json({ error: "AI rate limit reached — please try again shortly." }, 429);
      if (res.status === 402) return json({ error: "AI credits are exhausted. Add credits to continue." }, 402);
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        return json({ error: `Could not parse the line items: ${res.status} ${detail}`.trim() }, 502);
      }

      const payload = await res.json();
      const raw = payload?.choices?.[0]?.message?.content ?? "";
      const parsed = pickJson(String(raw)) as { items?: unknown[]; notes?: string };

      const items = (Array.isArray(parsed.items) ? parsed.items : []).slice(0, 40).map((i) => {
        const it = i as Record<string, unknown>;
        const qty = Number(it.quantity);
        return {
          name: String(it.name ?? "").slice(0, 160),
          description: String(it.description ?? "").slice(0, 400),
          quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
          unit: String(it.unit ?? "each").slice(0, 12),
          search_terms: String(it.search_terms ?? it.name ?? "").slice(0, 120),
          spoken_price: it.spoken_price === null || it.spoken_price === undefined
            ? null
            : Number(it.spoken_price) || null,
          kind: String(it.kind ?? "equipment").slice(0, 20),
        };
      }).filter((i) => i.name);

      // A voice-built quote is a write action: log the draft as awaiting
      // confirmation, exactly like the other write tools.
      await db.from("nl_audit_log").insert({
        user_id: userId,
        company_id: companyId,
        tool_name: "build_quote_from_speech",
        args: { transcript, quote_id: body?.quote_id ?? null },
        result: { channel: "voice_quote", item_count: items.length, notes: parsed.notes ?? "" },
        status: "confirmation_required",
      });

      return json({ transcript, items, notes: String(parsed.notes ?? "") });
    }

    // ---------------------------------------------------------------- audit
    if (action === "audit") {
      const status = body?.confirmed ? "executed" : "cancelled";
      await db.from("nl_audit_log").insert({
        user_id: userId,
        company_id: companyId,
        tool_name: "build_quote_from_speech",
        args: { quote_id: body?.quote_id ?? null },
        result: {
          channel: "voice_quote",
          items: Array.isArray(body?.items) ? body.items.slice(0, 40) : [],
          transcript: String(body?.transcript ?? "").slice(0, 2000),
        },
        status,
      });
      return json({ ok: true, status });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    console.error("[voice-quote-parse]", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
