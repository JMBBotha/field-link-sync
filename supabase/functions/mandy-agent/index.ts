/**
 * mandy-agent — Grok tool-calling brain for the Mandy voice dock.
 *
 * Actions:
 *   chat   { messages, tools, context }  -> { tool_call } | { text }
 *          Calls xAI chat completions with the tool list the BROWSER sends.
 *          This function never reads or writes quote data; the browser runs
 *          each tool under the user's own session (RLS + pricing rules).
 *   tts    { text }                      -> { audio_base64, mime, spoken }
 *          xAI text-to-speech (voice "eve"). Numbers/money converted to speech.
 *   audit  { tool, args, result, ok }    -> { ok }
 *          nl_audit_log row (channel "mandy_grok").
 *
 * xAI only (XAI_API_KEY). No OpenAI / Whisper / Lovable gateway on this path.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireUser, authCorsHeaders } from "../_shared/auth.ts";
import { toSpeech } from "../_shared/toSpeech.ts";

const cors = authCorsHeaders;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MODEL = Deno.env.get("XAI_CHAT_MODEL") || "grok-4.20-0309-non-reasoning";

const SYSTEM = `You are Mandy, the in-app operations assistant for a South African air-conditioning company (0800-BE-COOL).
You control the app ONLY through the tools provided. The browser runs each tool and returns what actually happened.

Rules:
- Never claim something happened unless a tool result says it did. If a tool fails, say so plainly.
- If a tool result contains "choices", ask the user to tap the right one on screen. Never guess.
- If a tool result says "awaiting_confirmation", tell the user to tap Confirm on screen. It has NOT happened yet.
- "the last quote", "latest quote", "most recent quote" => open_last_quote (or open_latest_quote). "open the top one" on the Quotes list => open_top_quote.
- When ONE request contains several quote edits (e.g. "Bedroom 2: add a 12K Samsung with 3 m kit and 2 hours labour"), call run_plan ONCE with the ordered steps (each step = an action name + its args). Never split them into separate calls.
- Refer to quote lines the way the user did ("the labour", "the Samsung", "the kit in bedroom 1"); the app resolves them.
- Quote-scoped tools only exist while a quote is open. If the user asks for quote work and no quote tools are available, open the quote first.
- Reply in ONE short sentence (two at most): the read-back of what was actually done, or one clarifying question.
- No filler, no "one moment", no "let me", no "just a sec", no narration of steps.
- Write money as R17 825.22 and say whether it is excl. or incl. VAT when the tool said so. VAT is 15%.
- Use metric units. Keep product names short (brand + size + type).

Disambiguation (strict):
- "describe X as …" => describe_area. NEVER rename_area.
- "add a note …" / "note: …" => add_note (target "quote" unless a line is named). NEVER add_area.
- "duplicate X as Y" / "copy X to Y" => duplicate_area (copies all lines). NEVER add_area.
- "set/change the <item> price to N" => set_line_price.
- "add N hours" => set_labour_hours mode="add"; "make it / set N hours" => mode="set".
- A sentence with 2+ edits => run_plan (one card).
- Adding an AC unit with no area named => call add_item_to_area WITHOUT area; the app asks with area chips. Never default to General.
- "it / that / the same" refers to the last line touched; "move it back" => move_item {item:"it", area:"back"}.
- If no tool fits, say so in one sentence. Never use a different tool as a substitute.`;

/** Client bundles older than this (YYYYMMDDHHMMSS) are told to update instead of routing. */
const MIN_CLIENT_BUILD = Deno.env.get("MANDY_MIN_CLIENT_BUILD") || "20260925200552";
export function clientBuildTooOld(clientBuild: unknown, min = MIN_CLIENT_BUILD): boolean {
  if (!min) return false;
  const c = typeof clientBuild === "string" ? clientBuild.trim() : "";
  if (!c) return true; // pre-version-check bundles send nothing
  if (c === "dev") return false;
  return c < min;
}
const STALE_TEXT = "This Field Lynk tab is running an old version. Please refresh with Ctrl+Shift+R (or close and reopen the app), then try again. Your sign-in stays.";
const reqMeta = (req: Request) => ({
  origin: (req.headers.get("origin") || "").slice(0, 200) || null,
  referer: (req.headers.get("referer") || "").slice(0, 300) || null,
  ua: (req.headers.get("user-agent") || "").slice(0, 300) || null,
});

type Msg = Record<string, unknown>;

async function xaiChat(key: string, messages: Msg[], tools: unknown[], forceText: boolean) {
  const body: Record<string, unknown> = {
    model: MODEL,
    temperature: 0,
    messages,
  };
  if (tools.length) {
    body.tools = tools;
    body.tool_choice = forceText ? "none" : "auto";
    body.parallel_tool_calls = false;
  }
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { error: `Mandy's brain returned ${res.status}. ${detail.slice(0, 300)}`, status: res.status };
  }
  return { data: await res.json() };
}

/* ───────────── intent router adapters ─────────────
 * ONE function per provider. Each takes the conversation + browser tool list
 * and returns the same shape, so the model can be swapped / A/B'd via
 * MANDY_ROUTER_PROVIDER without touching the dock. */
type RouteOut =
  | { action: string | null; args: Record<string, unknown>; confidence: number; text?: string; call_id?: string; assistant_message?: Msg; model: string }
  | { error: string; status: number };

const CONFIDENCE_PROP = {
  type: "number",
  minimum: 0,
  maximum: 1,
  description: "Your confidence (0-1) that this is the action the user meant, with these arguments.",
};

/** Adds a required `confidence` number to every tool's parameters. */
function withConfidence(tools: unknown[]): unknown[] {
  return tools.map((t) => {
    const tool = t as { type: string; function: { name: string; description?: string; parameters?: Record<string, any> } };
    const params = tool.function.parameters ?? { type: "object", properties: {} };
    return {
      ...tool,
      function: {
        ...tool.function,
        parameters: {
          ...params,
          properties: { ...(params.properties ?? {}), confidence: CONFIDENCE_PROP },
          required: Array.from(new Set([...(params.required ?? []), "confidence"])),
        },
      },
    };
  });
}

async function routeWithGrok(key: string, messages: Msg[], tools: unknown[], forceText: boolean): Promise<RouteOut> {
  const out = await xaiChat(key, messages, withConfidence(tools), forceText);
  if ("error" in out) return { error: out.error!, status: out.status ?? 502 };
  const msg = out.data?.choices?.[0]?.message ?? {};
  const call = Array.isArray(msg.tool_calls) ? msg.tool_calls[0] : null;
  if (call?.function?.name) {
    let raw: Record<string, unknown> = {};
    try { raw = JSON.parse(call.function.arguments || "{}"); } catch { raw = {}; }
    const { confidence, ...args } = raw;
    const c = Number(confidence);
    return {
      action: call.function.name,
      args,
      confidence: Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : 0,
      call_id: call.id,
      assistant_message: { role: "assistant", content: msg.content ?? "", tool_calls: [call] },
      model: MODEL,
    };
  }
  return { action: null, args: {}, confidence: 1, text: String(msg.content ?? "").trim(), model: MODEL };
}

const ROUTERS: Record<string, (key: string, messages: Msg[], tools: unknown[], forceText: boolean) => Promise<RouteOut>> = {
  grok: routeWithGrok,
};

export { toSpeech };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  const key = Deno.env.get("XAI_API_KEY");
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid request body." }, 400); }
  const action = String(body.action ?? "");

  if (action === "audit") {
    if (!auth.userId) return json({ ok: false });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: prof } = await db.from("profiles").select("company_id").eq("id", auth.userId).maybeSingle();
    const tool = String(body.tool ?? "").slice(0, 60);
    if (!tool) return json({ error: "tool required" }, 400);
    await db.from("nl_audit_log").insert({
      user_id: auth.userId,
      company_id: prof?.company_id ?? null,
      tool_name: `mandy_grok:${tool}`,
      args: { channel: "mandy_grok", client_build: typeof body.client_build === "string" ? body.client_build.slice(0, 40) : null, ...(typeof body.args === "object" && body.args ? body.args as object : {}) },
      result: typeof body.result === "object" ? body.result : { text: String(body.result ?? "").slice(0, 500) },
      status: body.ok ? "success" : "error",
      resource_type: "voice_action",
    });
    return json({ ok: true });
  }

  if (!key) return json({ error: "Mandy is not configured — add the secret XAI_API_KEY." }, 500);

  if (action === "tts") {
    const text = String(body.text ?? "").trim().slice(0, 1200);
    if (!text) return json({ error: "No text." }, 400);
    const spoken = toSpeech(text);
    const res = await fetch("https://api.x.ai/v1/tts", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: spoken, voice_id: "eve", language: "en" }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return json({ error: `TTS ${res.status}: ${detail.slice(0, 200)}`, spoken }, res.status);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return json({ audio_base64: btoa(bin), mime: res.headers.get("content-type") || "audio/mpeg", spoken });
  }

  if (action === "route" || action === "chat") {
    if (clientBuildTooOld(body.client_build)) return json({ stale_client: true, text: STALE_TEXT, action: null, args: {}, confidence: 1 });
    const messages = Array.isArray(body.messages) ? (body.messages as Msg[]).slice(-40) : [];
    const tools = Array.isArray(body.tools) ? (body.tools as unknown[]).slice(0, 40) : [];
    if (!messages.length) return json({ error: "No messages." }, 400);
    const ctx = body.context && typeof body.context === "object" ? JSON.stringify(body.context).slice(0, 1500) : "{}";
    const full: Msg[] = [
      { role: "system", content: `${SYSTEM}\n\nCurrent screen context (hint only): ${ctx}` },
      ...messages,
    ];
    const provider = (Deno.env.get("MANDY_ROUTER_PROVIDER") || "grok").toLowerCase();
    const adapter = ROUTERS[provider];
    if (!adapter) return json({ error: `Unknown MANDY_ROUTER_PROVIDER "${provider}".` }, 500);
    const out = await adapter(key, full, tools, body.force_text === true);
    if ("error" in out) return json({ error: out.error }, out.status === 429 ? 429 : 502);
    return json({ ...out, provider });
  }

  return json({ error: `Unknown action ${action}` }, 400);
});
