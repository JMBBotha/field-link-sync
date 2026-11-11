/**
 * Dashboard Mandy realtime session config.
 * The browser never sees XAI_API_KEY. mandy-realtime mints a short-lived
 * client secret and returns this session object for `session.update`.
 * Phone Mandy (Vapi) does not use this module.
 */
import { filterTools, toneBlock, type MandyTier } from "./mandyPolicy.ts";

export const HONEST_TOOL_RULE =
  "Never answer with an unrelated tool. A question about a photo, picture, image or brochure is read_quote_line_images, never the quote total. If no tool matches, say plainly what you cannot check and name one thing you can do.";

export const MISHEAR_RULE =
  'If you hear "slide" or "quilt" where the person means a quote (open the last slide, the quilt total, the photo on the slide), treat that word as "quote".';

export const MANDY_REALTIME_VOICE = "eve";
export const MANDY_REALTIME_MODEL = "grok-voice-latest";
/** Docs default is reasoning "high", which delays the first audio. Voice turns use none. */
export const MANDY_REALTIME_REASONING = "none";
export const MANDY_REALTIME_SAMPLE_RATE = 24000;
/** Documented client-secret lifetime. The API rejects a session body on this call. */
export const MANDY_CLIENT_SECRET_SECONDS = 300;

export function realtimeSocketUrl(conversationId?: string | null): string {
  const q = new URLSearchParams();
  q.set("model", MANDY_REALTIME_MODEL);
  q.set("reasoning.effort", MANDY_REALTIME_REASONING);
  if (conversationId) q.set("conversation_id", conversationId);
  return `wss://api.x.ai/v1/realtime?${q.toString()}`;
}

export function clientBuildTooOld(clientBuild: unknown, min: string): boolean {
  if (!min) return false;
  const c = typeof clientBuild === "string" ? clientBuild.trim() : "";
  if (!c) return true;
  if (c === "dev") return false;
  return c < min;
}

type ToolFn = { name?: unknown; description?: unknown; parameters?: unknown };

/** OpenAI-style `{function:{name}}` or a flat realtime tool → flat function tool. */
export function toRealtimeTool(tool: unknown): { type: "function"; name: string; description: string; parameters: unknown } | null {
  const o = tool as { type?: unknown; name?: unknown; description?: unknown; parameters?: unknown; function?: ToolFn };
  const fn = o?.function ?? o;
  const name = String(fn?.name ?? "").trim();
  if (!name || name.startsWith("__")) return null;
  return {
    type: "function",
    name,
    description: String(fn?.description ?? "").slice(0, 800),
    parameters: fn?.parameters ?? { type: "object", properties: {} },
  };
}

export function realtimeInstructions(p: {
  botName: string;
  companyName: string;
  parent: boolean;
  tier: string;
  context: unknown;
}): string {
  const ctx = JSON.stringify(p.context ?? {}).slice(0, 1200);
  return [
    toneBlock(p.botName, p.companyName),
    `You are speaking aloud to one signed-in ${p.tier} at ${p.companyName || "this company"}. You only know this company's records. Every tool runs in their browser under their own login.`,
    `Do the work only by calling a tool. Never say something happened unless that tool result says so.`,
    `When a result includes "say", speak that sentence and stop. Do not call another tool just to rephrase it.`,
    `Call another tool only when the request is still unfinished (they asked for a second action, or the result is not a finished sentence).`,
    `If the result has choices or awaiting_tap, ask them to tap one on screen. Never guess.`,
    `If the result has awaiting_confirmation, tell them to tap Confirm. It has not happened.`,
    `One short spoken sentence, two at most. Warm and brief. No "one moment", no "let me", no step-by-step narration.`,
    `Quote tools exist only while that quote's page is open. If they are not in your tool list, open the quote first.`,
    HONEST_TOOL_RULE,
    MISHEAR_RULE,
    `Money is rand. VAT is 15% when the tool said so. Use metric units. Keep product names short.`,
    p.parent ? `Top-level Massair view is on. Across other companies you are read-only. Give the totals first, then the one or two companies that need attention.` : "",
    `Screen context (hint only): ${ctx}`,
  ].filter(Boolean).join("\n");
}

export interface RealtimeSessionBody {
  voice: string;
  instructions: string;
  turn_detection: { type: "server_vad" };
  audio: {
    input: { format: { type: "audio/pcm"; rate: number }; transcription: { model: string; language_hint: string } };
    output: { format: { type: "audio/pcm"; rate: number }; speed: number };
  };
  tools: ReturnType<typeof toRealtimeTool>[];
  resumption: { enabled: true };
}

/** Role-filtered, screen-supplied tools plus the voice session. No API key. */
export function prepareRealtimeSession(input: {
  tier: MandyTier;
  parent: boolean;
  botName: string;
  companyName: string;
  tools: unknown[];
  context: unknown;
}): { url: string; session: RealtimeSessionBody; dropped: string[] } {
  const { kept, dropped } = filterTools(input.tier, Array.isArray(input.tools) ? input.tools.slice(0, 60) : [], input.parent);
  const tools = kept.map(toRealtimeTool).filter((t): t is NonNullable<typeof t> => !!t);
  const session: RealtimeSessionBody = {
    voice: MANDY_REALTIME_VOICE,
    instructions: realtimeInstructions(input),
    turn_detection: { type: "server_vad" },
    audio: {
      input: {
        format: { type: "audio/pcm", rate: MANDY_REALTIME_SAMPLE_RATE },
        transcription: { model: "grok-transcribe", language_hint: "en" },
      },
      output: {
        format: { type: "audio/pcm", rate: MANDY_REALTIME_SAMPLE_RATE },
        speed: 1.12,
      },
    },
    tools,
    resumption: { enabled: true },
  };
  return { url: realtimeSocketUrl(), session, dropped };
}

/** xAI returns `{ value, expires_at }`. Never forward the raw body. */
export function readClientSecret(body: unknown): { token: string; expiresAt: number } | null {
  const o = body as { value?: unknown; token?: unknown; client_secret?: unknown; expires_at?: unknown } | null;
  const token = String(o?.value ?? o?.token ?? o?.client_secret ?? "").trim();
  if (token.length < 12) return null;
  const expiresAt = Number(o?.expires_at);
  return { token, expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0 };
}
