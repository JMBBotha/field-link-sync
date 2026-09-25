/**
 * Mandy intent router — the ONE place that turns "what the user said" into
 * "which action to run". The dock only calls routeVoiceCommand(); the model
 * provider behind it (Grok today, set by MANDY_ROUTER_PROVIDER on the server)
 * can be swapped or A/B'd without touching the dock.
 */
import { supabase } from "@/integrations/supabase/client";
import { coerceMapAction } from "@/lib/mandy/mapStatus";

/** Below this, the dock asks / shows chips instead of running the action. */
export const MANDY_MIN_CONFIDENCE = 0.7;

export type RouterMsg = Record<string, unknown>;

export interface RouteInput {
  /** Latest user words. Empty on follow-up steps (tool result already in history). */
  transcript: string;
  /** Prior conversation, including tool calls/results from this turn. */
  history: RouterMsg[];
  /** Tool definitions currently available on screen. */
  tools: unknown[];
  /** Live UI context hint (page, open quote, …). */
  context: Record<string, unknown>;
  /** Force a text answer (last step of a turn). */
  forceText?: boolean;
}

export interface RouteResult {
  action: string | null;
  args: Record<string, unknown>;
  confidence: number;
  text?: string;
  /** Provider bookkeeping so the tool result can be replayed next step. */
  callId?: string;
  assistantMessage?: RouterMsg;
  error?: string;
}

export async function routeVoiceCommand(input: RouteInput): Promise<RouteResult> {
  const messages = input.transcript.trim()
    ? [...input.history, { role: "user", content: input.transcript.trim() }]
    : input.history;
  const { data, error } = await supabase.functions.invoke("mandy-agent", {
    body: { action: "route", messages, tools: input.tools, context: input.context, force_text: !!input.forceText },
  });
  const d = (data ?? {}) as Record<string, any>;
  if (error || d.error) {
    return { action: null, args: {}, confidence: 0, error: String(d.error || error?.message || "Router unavailable") };
  }
  return postProcessRoute({
    action: typeof d.action === "string" ? d.action : null,
    args: d.args && typeof d.args === "object" ? d.args : {},
    confidence: Number.isFinite(Number(d.confidence)) ? Number(d.confidence) : 0,
    text: typeof d.text === "string" ? d.text : undefined,
    callId: d.call_id,
    assistantMessage: d.assistant_message,
  }, input.transcript);
}

/** Post-process the provider's pick (e.g. open_live_map + a status → filter). */
export function postProcessRoute(r: RouteResult, transcript: string): RouteResult {
  const c = coerceMapAction(r.action, r.args, transcript);
  return c.action === r.action ? r : { ...r, action: c.action, args: c.args };
}

export interface GateDecision {
  run: boolean;
  /** Present when the dock must ask instead of running. */
  choice?: { label: string; action: string; args: Record<string, unknown> };
  question?: string;
}

const actionLabel = (action: string, args: Record<string, unknown>) => {
  const words = action.replace(/_/g, " ");
  const detail = Object.values(args).filter((v) => typeof v === "string" || typeof v === "number").slice(0, 2).join(", ");
  return detail ? `${words}: ${detail}` : words;
};

/** Confidence gate: below MANDY_MIN_CONFIDENCE never run — one chip + one-line question. */
export function gateRoute(r: Pick<RouteResult, "action" | "args" | "confidence">, threshold = MANDY_MIN_CONFIDENCE): GateDecision {
  if (!r.action) return { run: false };
  if (r.confidence >= threshold) return { run: true };
  const label = actionLabel(r.action, r.args);
  return {
    run: false,
    choice: { label: `Yes — ${label}`, action: r.action, args: r.args },
    question: `Did you mean ${label}? Tap it, or say it another way.`,
  };
}
