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
import { spokenRand, numberToWords } from "../_shared/numberSpeech.ts";

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
- "the last quote", "latest quote", "most recent quote" => open_last_quote.
- Quote-scoped tools only exist while a quote is open. If the user asks for quote work and no quote tools are available, open the quote first.
- Reply in ONE short sentence (two at most): the read-back of what was actually done, or one clarifying question.
- No filler, no "one moment", no "let me", no "just a sec", no narration of steps.
- Write money as R17 825.22 and say whether it is excl. or incl. VAT when the tool said so. VAT is 15%.
- Use metric units. Keep product names short (brand + size + type).`;

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

/** Money / BTU / refs → natural speech, so TTS never reads digits one by one. */
export function toSpeech(text: string): string {
  let t = text;
  t = t.replace(/R\s?(\d{1,3}(?:[ \u00a0,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/g, (_m, num: string) => {
    let s = num.replace(/[\u00a0 ]/g, "");
    // "17,825.22" or "17825,22"
    if (/,\d{1,2}$/.test(s) && !/\.\d/.test(s)) s = s.replace(/,(\d{1,2})$/, ".$1");
    s = s.replace(/,/g, "");
    const n = Number(s);
    return Number.isFinite(n) ? (spokenRand(n) ?? _m) : _m;
  });
  t = t.replace(/(\d[\d ,]*)\s?BTU/gi, (_m, n: string) => `${numberToWords(Number(n.replace(/[ ,]/g, "")))} BTU`);
  t = t.replace(/\b(\d+)\s?K\b/g, (_m, n: string) => `${numberToWords(Number(n))} thousand BTU`);
  t = t.replace(/\bQ-(\d{4})-(\d+)\b/g, (_m, y: string, n: string) => `Q ${y.split("").join(" ")} ${n.split("").join(" ")}`);
  t = t.replace(/\bexcl\.?\s*VAT\b/gi, "excluding VAT").replace(/\bincl\.?\s*VAT\b/gi, "including VAT");
  t = t.replace(/(\d+(?:\.\d+)?)\s?m\b/g, (_m, n: string) => `${n} metre${n === "1" ? "" : "s"}`);
  return t;
}

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
      args: { channel: "mandy_grok", ...(typeof body.args === "object" && body.args ? body.args as object : {}) },
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

  if (action === "chat") {
    const messages = Array.isArray(body.messages) ? (body.messages as Msg[]).slice(-40) : [];
    const tools = Array.isArray(body.tools) ? (body.tools as unknown[]).slice(0, 40) : [];
    if (!messages.length) return json({ error: "No messages." }, 400);
    const ctx = body.context && typeof body.context === "object" ? JSON.stringify(body.context).slice(0, 1500) : "{}";
    const full: Msg[] = [
      { role: "system", content: `${SYSTEM}\n\nCurrent screen context (hint only): ${ctx}` },
      ...messages,
    ];
    const out = await xaiChat(key, full, tools, body.force_text === true);
    if ("error" in out) return json({ error: out.error }, out.status === 429 ? 429 : 502);
    const msg = out.data?.choices?.[0]?.message ?? {};
    const call = Array.isArray(msg.tool_calls) ? msg.tool_calls[0] : null;
    if (call?.function?.name) {
      let args: unknown = {};
      try { args = JSON.parse(call.function.arguments || "{}"); } catch { args = {}; }
      return json({
        tool_call: { id: call.id, name: call.function.name, arguments: args },
        assistant_message: { role: "assistant", content: msg.content ?? "", tool_calls: [call] },
        model: MODEL,
      });
    }
    return json({ text: String(msg.content ?? "").trim(), model: MODEL });
  }

  return json({ error: `Unknown action ${action}` }, 400);
});
