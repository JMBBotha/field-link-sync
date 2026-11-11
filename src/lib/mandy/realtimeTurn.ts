/**
 * Pure turn logic for dashboard Mandy's realtime voice session.
 * The socket client applies these decisions; tests cover them without a network.
 */
import type { MandyResult } from "./actions";

export type MandyPhase = "idle" | "starting" | "greeting" | "listening" | "hearing" | "working" | "thinking" | "speaking" | "disconnected";

export type MandyTurnEvent =
  | { type: "connect_start" }
  | { type: "session_live" }
  | { type: "speech_started" }
  | { type: "speech_stopped" }
  | { type: "response_created" }
  | { type: "audio_out" }
  | { type: "function_call" }
  | { type: "response_done"; audioQueued: boolean }
  | { type: "playback_ended" }
  | { type: "session_closed" }
  | { type: "session_dropped" }
  | { type: "legacy_hearing" }
  | { type: "legacy_thinking" };

/** VITE_MANDY_REALTIME=0 (or false/off/legacy) keeps the batch mic → STT → chat → TTS path. */
export function mandyRealtimeEnabled(flag?: string | null): boolean {
  const v = String(flag ?? "").trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off" || v === "legacy") return false;
  return true;
}

export function mandyStatusLabel(phase: MandyPhase): string {
  switch (phase) {
    case "starting": return "Starting…";
    case "greeting":
    case "speaking": return "Mandy is speaking…";
    case "listening": return "Listening…";
    case "hearing": return "Hearing you…";
    case "working":
    case "thinking": return "Thinking…";
    case "disconnected": return "Mandy disconnected, tap to reconnect";
    case "idle": return "Ready";
  }
}

export function isMandyBusy(phase: MandyPhase): boolean {
  return phase === "hearing" || phase === "working" || phase === "greeting" || phase === "starting";
}

/**
 * Server VAD drives the turn. Ready (idle) only after the session closes —
 * never while she is listening, thinking, or still playing audio.
 */
export function nextMandyPhase(phase: MandyPhase, event: MandyTurnEvent): MandyPhase {
  switch (event.type) {
    case "connect_start": return "starting";
    case "session_live": return phase === "speaking" || phase === "thinking" ? phase : "listening";
    case "speech_started": return "listening";
    case "speech_stopped": return "thinking";
    case "response_created": return phase === "speaking" ? phase : "thinking";
    case "function_call": return "thinking";
    case "audio_out": return "speaking";
    case "response_done": return event.audioQueued || phase === "speaking" ? "speaking" : "thinking";
    case "playback_ended": return "listening";
    case "session_closed": return "idle";
    case "session_dropped": return "disconnected";
    case "legacy_hearing": return "hearing";
    case "legacy_thinking": return "thinking";
    default: return phase;
  }
}

export function phaseAfterResponseDone(input: { hadAudio: boolean; pendingTools: number; playbackPending: boolean }): MandyPhase {
  if (input.pendingTools > 0) return "thinking";
  if (input.hadAudio || input.playbackPending) return "speaking";
  return "listening";
}

/** Stop local audio the moment server VAD hears him over her. */
export function bargeIn(phase: MandyPhase): { phase: MandyPhase; stopPlayback: boolean } {
  return { phase: "listening", stopPlayback: phase === "speaking" || phase === "thinking" || phase === "greeting" };
}

const OPEN_QUOTE = new Set(["open_quote", "open_last_quote", "open_latest_quote", "open_top_quote", "create_quote_for_client"]);
const MORE_WORK = /\b(add|set|change|remove|make|put|delete|update|rename|describe|duplicate|hours|labou?r|kit|price|note|total|qty|quantity|read)\b/i;

/** The page's quote tools are only needed when this turn still has quote work to do. */
export function shouldWaitForQuoteTools(action: string, transcript: string): boolean {
  if (!OPEN_QUOTE.has(action)) return false;
  return MORE_WORK.test(transcript || "");
}

export function isUserFacingSentence(message: string): boolean {
  const m = (message || "").trim();
  if (m.length < 4 || /^[{\[]/.test(m) || !/[a-z]/i.test(m)) return false;
  return /[.!?]["']?$/.test(m) || m.split(/\s+/).length >= 3;
}

export type ToolReplyPlan = "speak" | "continue";

/** Speak the tool sentence now. Continue only when another tool is actually required. */
export function continueAfterTool(action: string, result: Pick<MandyResult, "ok" | "message" | "choices" | "confirm">, transcript: string): ToolReplyPlan {
  if (result.choices?.length || result.confirm) return "speak";
  if (!isUserFacingSentence(result.message)) return "continue";
  if (shouldWaitForQuoteTools(action, transcript)) return "continue";
  if (/^(find_client|select_client|open_client)$/.test(action) && /\b(quote|invoice|new quote|add)\b/i.test(transcript || "")) return "continue";
  return "speak";
}

export function replyPlan(batch: Array<{ action: string; result: Pick<MandyResult, "ok" | "message" | "choices" | "confirm"> }>, transcript: string): ToolReplyPlan {
  if (batch.length !== 1) return batch.length ? "continue" : "speak";
  return continueAfterTool(batch[0].action, batch[0].result, transcript);
}

export function spokenToolText(results: Array<Pick<MandyResult, "message">>): string {
  return results.map((r) => (r.message || "").trim()).filter(Boolean).join(" ");
}

/** One response.create after every call in the turn has an output. */
export function shouldRequestContinuation(pending: number, outputsSent: number, turnDone: boolean): boolean {
  return turnDone && pending > 0 && outputsSent === pending;
}

export function functionCallOutputMessage(callId: string, result: Pick<MandyResult, "ok" | "message" | "choices" | "confirm">) {
  return {
    type: "conversation.item.create" as const,
    item: {
      type: "function_call_output" as const,
      call_id: callId,
      output: JSON.stringify({
        ok: result.ok,
        say: result.message,
        ...(result.choices?.length ? { choices: result.choices.map((c) => c.label), awaiting_tap: true } : {}),
        ...(result.confirm ? { awaiting_confirmation: result.confirm.summary } : {}),
      }),
    },
  };
}

/** Verbatim line in the session voice. Not a second model turn. */
export function forceMessageItem(text: string) {
  return {
    type: "conversation.item.create" as const,
    item: {
      type: "force_message" as const,
      role: "assistant" as const,
      interruptible: true,
      content: [{ type: "output_text" as const, text }],
    },
  };
}

export function responseCreateMessage() {
  return { type: "response.create" as const };
}

export function sessionUpdateMessage(session: unknown) {
  return { type: "session.update" as const, session };
}

/** Field name matches the OpenAI Realtime shape xAI documents as the migration base. */
export function appendAudioMessage(audio: string) {
  return { type: "input_audio_buffer.append" as const, audio };
}

export function userTextMessage(text: string) {
  return {
    type: "conversation.item.create" as const,
    item: { type: "message" as const, role: "user" as const, content: [{ type: "input_text" as const, text }] },
  };
}

export function truncatePlaybackMessage(itemId: string, audioEndMs: number) {
  return {
    type: "conversation.item.truncate" as const,
    item_id: itemId,
    content_index: 0,
    audio_end_ms: Math.max(0, Math.round(audioEndMs)),
  };
}

export function downsampleFloat(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (!(fromRate > 0) || !(toRate > 0) || toRate >= fromRate) return input;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

export function rmsLevel(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.min(1, Math.sqrt(sum / samples.length) * 8);
}

export function floatToPcm16Base64(samples: Float32Array): string {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  const bytes = new Uint8Array(pcm.buffer);
  let bin = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(bin);
}

export function base64Pcm16ToFloat32(b64: string): Float32Array {
  if (!b64) return new Float32Array();
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = Math.floor(bytes.byteLength / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

export const REALTIME_SAMPLE_RATE = 24000;

/**
 * While she is speaking, mic frames quieter than this are playback echo and
 * are not sent. rmsLevel() is 0–1 (raw RMS × 8). Normal speech sits above this.
 */
export const BARGE_IN_LEVEL = 0.2;

export function shouldForwardMic(input: { speaking: boolean; level: number; latched: boolean }): { forward: boolean; latched: boolean } {
  if (!input.speaking) return { forward: true, latched: false };
  if (input.latched || input.level >= BARGE_IN_LEVEL) return { forward: true, latched: true };
  return { forward: false, latched: false };
}

/** Manual cancel. Server VAD also interrupts, but Stop and "Mandy stop" send this. */
export function responseCancelMessage() {
  return { type: "response.cancel" as const };
}

export const TOOL_TIMEOUT_MS = 12_000;
export const TOOL_TIMEOUT_SAY = "That took too long, so I stopped waiting. Ask me again if you still want it.";

/** First spoken filler only after the tool has already taken this long. Fast answers stay quiet. */
export const FILLER_FIRST_MS = 1_500;
/** Second and last filler on a slow tool. */
export const FILLER_SECOND_MS = 6_000;
export const STILL_ON_IT = "Still on it…";

const NO_FILLER_TOOLS = new Set(["report_problem"]);

export function spokenFirstName(raw: unknown): string | null {
  const tokens = String(raw ?? "")
    .replace(/[^A-Za-z\s'-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !/^(de|van|der|den|du|le|la|the|of)$/i.test(t));
  const first = tokens[0];
  if (!first) return null;
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

export function nameFromToolArgs(args: Record<string, unknown> | undefined): string | null {
  if (!args) return null;
  return spokenFirstName(args.lead ?? args.client ?? args.query ?? args.customer ?? args.technician ?? args.name ?? "");
}

/** Short lines for a slow tool. Varied so the next lookup does not repeat the last one. */
export function fillerOptions(tool: string, name: string | null): string[] {
  if (NO_FILLER_TOOLS.has(tool)) return [];
  const n = name;
  switch (tool) {
    case "why_lead_waiting":
      return n
        ? [`Looking up ${n} now…`, `Checking why ${n} is waiting…`, `Finding ${n}'s lead…`]
        : ["Looking up that lead…", "Checking why that lead is waiting…"];
    case "find_client":
    case "open_client":
    case "select_client":
    case "create_quote_for_client":
      return n
        ? [`Looking up ${n} now…`, `Searching for ${n}…`, `Checking ${n} on the list…`]
        : ["Looking up that client…", "Searching the client list…"];
    case "unpaid_for":
      return n ? [`Checking what ${n} still owes…`, `Looking at ${n}'s invoices…`] : ["Checking what's unpaid…", "Looking at the invoices…"];
    case "tech_day":
      return ["Checking today's jobs…", "Looking at the day…"];
    case "assign_lead_technician":
    case "cancel_visit":
    case "reschedule_visit":
      return ["Checking his visits…", "Looking at the booking…", "Checking the schedule…"];
    case "open_quote":
    case "open_last_quote":
    case "open_latest_quote":
    case "open_top_quote":
      return ["Opening that quote…", "Finding the quote…"];
    default:
      return ["Checking that now…", "Looking that up…", "Working on that…"];
  }
}

export function pickVaried(options: string[], recent: string[]): string | null {
  if (!options.length) return null;
  const last = recent[recent.length - 1];
  const fresh = options.filter((o) => !recent.includes(o));
  const pool = fresh.length ? fresh : options.filter((o) => o !== last);
  return pool[0] || options[0];
}

/**
 * At most two fillers per turn: one specific line after ~1.5s, then
 * "Still on it…" after ~6s. Nothing before 1.5s. report_problem is silent
 * here because its own sentence is spoken as soon as the tool starts.
 */
export function nextWorkingFiller(input: {
  tool: string;
  args?: Record<string, unknown>;
  elapsedMs: number;
  spokenThisTurn: string[];
  recent: string[];
}): string | null {
  if (input.spokenThisTurn.length >= 2) return null;
  if (NO_FILLER_TOOLS.has(input.tool)) return null;
  if (input.spokenThisTurn.length === 0) {
    if (input.elapsedMs < FILLER_FIRST_MS) return null;
    return pickVaried(fillerOptions(input.tool, nameFromToolArgs(input.args)), input.recent);
  }
  if (input.elapsedMs < FILLER_SECOND_MS) return null;
  if (input.spokenThisTurn.includes(STILL_ON_IT)) return null;
  return STILL_ON_IT;
}

/** Subtle label beside Thinking… while a tool is in flight. */
export function workingStepLabel(tool: string): string {
  switch (tool) {
    case "find_client":
    case "open_client":
    case "select_client":
    case "create_quote_for_client":
      return "Looking up client…";
    case "why_lead_waiting":
      return "Looking up lead…";
    case "unpaid_for":
      return "Checking invoices…";
    case "assign_lead_technician":
    case "cancel_visit":
    case "reschedule_visit":
      return "Checking visits…";
    case "tech_day":
      return "Checking today's jobs…";
    case "open_quote":
    case "open_last_quote":
    case "open_latest_quote":
    case "open_top_quote":
      return "Opening the quote…";
    case "report_problem":
      return "Logging that…";
    default:
      return "Working…";
  }
}

export function settleWithin<T>(work: Promise<T>, ms: number, fallback: T): Promise<{ value: T; timedOut: boolean }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: T, timedOut: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ value, timedOut });
    };
    const timer = setTimeout(() => finish(fallback, true), ms);
    work.then(
      (value) => finish(value, false),
      () => finish(fallback, true),
    );
  });
}

/** Late tool results after Stop are dropped when the generation has moved on. */
export function takeIfCurrent<T>(generation: number, current: number, value: T): T | null {
  return generation === current ? value : null;
}

/**
 * A dropped socket reconnects with a fresh token. The user hanging up, or a
 * socket we closed ourselves to swap tokens, does not.
 */
export function shouldAutoReconnect(input: { userStopped: boolean; swapping: boolean; attempts: number; maxAttempts?: number }): boolean {
  if (input.userStopped || input.swapping) return false;
  return input.attempts < (input.maxAttempts ?? 2);
}

export function closeTrace(
  ev: { code: number; reason: string; wasClean: boolean },
  extra: { phase: string; tool: string | null },
) {
  return {
    kind: "socket_close" as const,
    code: ev.code,
    reason: ev.reason || "",
    wasClean: ev.wasClean,
    phase: extra.phase,
    tool: extra.tool,
  };
}

export function historySeedMessages(turns: Array<{ role: "user" | "assistant"; text: string }>) {
  return turns
    .filter((t) => t.text && t.text.trim())
    .slice(-8)
    .map((t) => t.role === "user"
      ? userTextMessage(t.text.trim())
      : {
          type: "conversation.item.create" as const,
          item: {
            type: "message" as const,
            role: "assistant" as const,
            content: [{ type: "output_text" as const, text: t.text.trim() }],
          },
        });
}

export function sayInChatPanel(text: string): string {
  return String(text || "")
    .replace(/\bon the dashboard\b/gi, "in my chat panel")
    .replace(/\bscroll up\b/gi, "look at the buttons in my chat panel");
}

/** Tool sentences she speaks must point at her chat panel, never the page around it. */
export function spokenPanelLine(message: string, kind: "choices" | "confirm" | "plain"): string {
  let m = sayInChatPanel(message || "").replace(/\s+/g, " ").trim();
  if (kind === "choices" && !/chat panel/i.test(m)) {
    m = m.replace(/waiting for the user to tap one\.?/gi, "").trim();
    m = `${m} Tap the buttons in my chat panel, or say the first one or the name.`.replace(/\s+/g, " ").trim();
  }
  if (kind === "confirm" && !/chat panel/i.test(m)) {
    m = `${m.replace(/[?.!]+$/, "").trim()}. Tap the Confirm button in my chat panel, or say yes.`;
  }
  return m;
}
