/**
 * Mandy intent router — the ONE place that turns "what the user said" into
 * "which action to run". The dock only calls routeVoiceCommand(); the model
 * provider behind it (Grok today, set by MANDY_ROUTER_PROVIDER on the server)
 * can be swapped or A/B'd without touching the dock.
 */
import { supabase } from "@/integrations/supabase/client";

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
  return {
    action: typeof d.action === "string" ? d.action : null,
    args: d.args && typeof d.args === "object" ? d.args : {},
    confidence: Number.isFinite(Number(d.confidence)) ? Number(d.confidence) : 0,
    text: typeof d.text === "string" ? d.text : undefined,
    callId: d.call_id,
    assistantMessage: d.assistant_message,
  };
}
