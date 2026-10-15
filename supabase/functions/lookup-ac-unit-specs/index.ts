import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";

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


/* ───────── Unit cards (Johan 13 Oct 08:32): fetch specs/links/image/highlight into product_media as DRAFT ───────── */

const MEDIA_PROMPT = `You are an HVAC product data researcher for a South African aircon installer.
Given an exact air conditioner model number, use web search to find its OFFICIAL data. Prefer, in order:
the brand's South African site (e.g. samsung.com/za, midea.com/za, lg.com/za), the SA distributor (e.g. Fourways Airconditioning spec sheets), then the manufacturer's
global site. Only use retailer pages to confirm, never as the only source for numbers.
Return ONLY a JSON object, no prose, with keys:
{"display_name": "Brand Range Name", "family": "e.g. AR70", "subtitle": "12,000 BTU/h wall split",
 "product_url": "official product page URL or null", "support_url": "official support page URL or null",
 "image_url": "direct URL (ending in .png/.jpg/.webp where possible) of the official front photo of the INDOOR unit on a plain background (for samsung use images.samsung.com) or null",
 "source_label": "short domain of the main source",
 "bullets": ["3 to 5 plain-language client benefits, max 16 words each"],
 "specs": {"cool_kw": number|null, "heat_kw": number|null, "btu": number|null, "eer": number|null, "cop": number|null,
           "seer": number|null, "energy_class": string|null, "noise_in_db": "high/low" string|null, "noise_out_db": number|null,
           "refrigerant": string|null, "inverter": boolean|null, "wifi": boolean|null, "room_m2": string|null, "warranty": string|null},
 "feature_highlight": {"icon": one of "windfree","ai","fast","protect","inverter","filter","wifi","quiet",
                       "title": "the model's signature technology, e.g. WindFree™ cooling", "text": "one plain sentence on what it does for the client"} or null,
 "uncertain": ["list any field you could not confirm from an official source"]}
Never guess numbers: use null when not found.`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const normalizeModelCode = (c?: string | null) => {
  const s = String(c || "").split("+")[0].replace(/\(\s*x\s*\d+\s*\)/i, "").toUpperCase().replace(/\s+/g, "").replace(/-DUP\d*$/, "");
  return s || null;
};

function extractJson(text: string): any {
  const t = text.replace(/```json|```/g, "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("No JSON in model reply");
  return JSON.parse(t.slice(a, b + 1));
}

/** True when the bytes are a PNG with an alpha channel (colour type 4 or 6) => usable cut-out. */
function isAlphaPng(bytes: Uint8Array): boolean {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 26 || !sig.every((v, i) => bytes[i] === v)) return false;
  return bytes[25] === 6 || bytes[25] === 4;
}

/** Samsung's image server returns transparent PNG cut-outs with the PNG preset. */
function cutoutCandidate(url: string): string {
  if (/images\.samsung\.com\/is\/image\//.test(url)) return url.split("?")[0] + "?$650_519_PNG$";
  return url;
}

async function storeImage(db: any, key: string, src: string | null): Promise<Record<string, any>> {
  if (!src) return { image_status: "none", image_source_url: null };
  const url = cutoutCandidate(src);
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 FieldLynk/1.0" } });
    if (!r.ok) throw new Error(`image ${r.status}`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    const ct = (r.headers.get("content-type") || "").split(";")[0].trim();
    if (!/^image\/(png|jpe?g|webp)$/.test(ct) || bytes.length < 2000) return { image_status: "none", image_source_url: url };
    // Plain-background JPG/WebP photos are fine on the card; only alpha PNGs go in cutouts/.
    const alpha = isAlphaPng(bytes);
    const ext = ct === "image/png" ? "png" : ct === "image/webp" ? "webp" : "jpg";
    const path = `${alpha ? "cutouts" : "photos"}/${key.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.${ext}`;
    const up = await db.storage.from("product-media").upload(path, bytes, { contentType: ct, upsert: true });
    if (up.error) throw up.error;
    const { data } = db.storage.from("product-media").getPublicUrl(path);
    return { image_status: "ready", image_source_url: url, image_path: path, image_url: data.publicUrl };
  } catch (e) {
    console.error("image store failed", key, e);
    return { image_status: "none", image_source_url: url };
  }
}

async function fetchModelContent(apiKey: string, db: any, key: string, hint: { brand?: string | null; description?: string | null }): Promise<Record<string, any>> {
  const query = `${hint.brand ? hint.brand + " " : ""}${key}${hint.description ? ` (${hint.description})` : ""}`;
  const res = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: XAI_MODEL, input: [{ role: "system", content: MEDIA_PROMPT }, { role: "user", content: `Model number: ${query}` }], tools: [{ type: "web_search" }] }),
  });
  if (!res.ok) throw new Error(`Responses API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data.output_text ?? data.output?.flatMap((i: any) => i.content ?? []).find((c: any) => c.type === "output_text")?.text;
  if (!text) throw new Error("Model returned no text");
  const j = extractJson(text);
  const img = await storeImage(db, key, j.image_url || null);
  const uncertain: string[] = Array.isArray(j.uncertain) ? j.uncertain : [];
  return {
    model_key: key, model_code: key, brand: hint.brand || null, family: j.family || null,
    display_name: j.display_name || null, subtitle: j.subtitle || null,
    product_url: j.product_url || null, support_url: j.support_url || null, source_label: j.source_label || null,
    bullets: Array.isArray(j.bullets) ? j.bullets.slice(0, 5).map(String) : [],
    specs: j.specs && typeof j.specs === "object" ? j.specs : {},
    feature_highlight: j.feature_highlight?.title ? j.feature_highlight : null,
    notes: uncertain.length ? `Unconfirmed: ${uncertain.join(", ")}` : null,
    status: "draft", fetch_error: null, fetched_at: new Date().toISOString(), ...img,
  };
}

async function handleMedia(req: Request, body: any): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const apiKey = Deno.env.get("XAI_API_KEY");
  if (!apiKey) return json({ error: "XAI_API_KEY not configured" }, 500);

  const force = body.action === "refetch_media";
  if (force && auth.userId) {
    // Re-fetching overwrites content: Massair admins only.
    const userDb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization")! } } });
    const { data: owner } = await userDb.rpc("is_platform_owner");
    if (owner !== true) return json({ error: "Massair admins only" }, 403);
  }
  const keys = [...new Set((Array.isArray(body.model_codes) ? body.model_codes : []).map((c: string) => normalizeModelCode(c)).filter(Boolean))].slice(0, force ? 1 : 6) as string[];
  if (!keys.length) return json({ results: [] });

  const { data: existing } = await db.from("product_media").select("model_key, status").in("model_key", keys);
  const have = new Set((existing || []).map((r: any) => r.model_key));
  const todo = force ? keys : keys.filter((k) => !have.has(k));
  const results: any[] = [];
  for (const key of todo) {
    // Claim the key first so parallel quote opens don't fetch twice.
    if (!force) {
      const { error: claimErr } = await db.from("product_media").insert({ model_key: key, model_code: key, status: "failed", fetch_error: "fetching…" });
      if (claimErr) { results.push({ key, skipped: "already claimed" }); continue; }
    }
    const { data: sp } = await db.from("supplier_products").select("brand, description, product_code").ilike("product_code", `${key}%`).limit(1).maybeSingle();
    try {
      const row = await fetchModelContent(apiKey, db, key, { brand: sp?.brand, description: sp?.description?.slice(0, 120) });
      if (sp?.product_code) row.model_code = String(sp.product_code).replace(/-DUP\d*$/i, "");
      const { error } = await db.from("product_media").upsert(row, { onConflict: "model_key" });
      if (error) throw error;
      results.push({ key, status: "draft", image_status: row.image_status });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.from("product_media").update({ status: "failed", fetch_error: msg.slice(0, 500), brand: sp?.brand ?? null }).eq("model_key", key);
      results.push({ key, error: msg });
    }
  }
  return json({ results });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    if (body?.action === "ensure_media" || body?.action === "refetch_media") return await handleMedia(req, body);
    const { query } = body;
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
