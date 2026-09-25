/**
 * Mandy intent router — the ONE place that turns "what the user said" into
 * "which action to run". The dock only calls routeVoiceCommand(); the model
 * provider behind it (Grok today, set by MANDY_ROUTER_PROVIDER on the server)
 * can be swapped or A/B'd without touching the dock.
 */
import { supabase } from "@/integrations/supabase/client";
import { coerceMapAction } from "@/lib/mandy/mapStatus";
import { parsePlan, type PlanStep } from "@/lib/mandy/quoteEdits";
import { parseMultiEdit } from "@/lib/mandy/multiEdit";
import { BUILD_ID } from "@/lib/buildInfo";

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
  /** Present when the router chose a multi-step plan (run_plan). */
  plan?: PlanStep[];
  /** Server says this client bundle is older than the minimum. */
  stale?: boolean;
}

export async function routeVoiceCommand(input: RouteInput): Promise<RouteResult> {
  const messages = input.transcript.trim()
    ? [...input.history, { role: "user", content: input.transcript.trim() }]
    : input.history;
  const { data, error } = await supabase.functions.invoke("mandy-agent", {
    body: { action: "route", messages, tools: input.tools, context: input.context, force_text: !!input.forceText, client_build: BUILD_ID },
  });
  const d = (data ?? {}) as Record<string, any>;
  if (d.stale_client) {
    return { action: null, args: {}, confidence: 1, text: String(d.text || "I've been updated — tap Update first."), stale: true } as RouteResult;
  }
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

/** 'set / make it N hours' → set; otherwise ('add N hours', 'another hour') → add. */
export function labourModeFromText(t: string): "add" | "set" {
  const s = (t || "").toLowerCase();
  if (/\b(set|make it|make that|change (it )?to|should be|total of|in total)\b/.test(s)) return "set";
  return "add";
}

/** Post-process the provider's pick (e.g. open_live_map + a status → filter). */
export function postProcessRoute(r0: RouteResult, transcript: string): RouteResult {
  // Deterministic post-check: 2+ edit clauses in the words → ONE local plan, whatever the model picked.
  const local = r0.action !== "run_plan" ? parseMultiEdit(transcript) : null;
  if (local) return { ...r0, action: "run_plan", args: { steps: local }, plan: local, confidence: Math.max(r0.confidence, 0.9) };
  const r = guardRoute(r0, transcript);
  if (r.action === "run_plan") {
    const plan = parsePlan(r.args).map((s) => (s.action === "set_labour_hours" && s.args.mode !== "add" && s.args.mode !== "set"
      ? { ...s, args: { ...s.args, mode: labourModeFromText(transcript) } } : s));
    return { ...r, plan };
  }
  const c = coerceMapAction(r.action, r.args, transcript);
  if (c.action === "set_labour_hours" && explicitLabourMode(transcript)) {
    return { ...r, action: c.action, args: { ...c.args, mode: explicitLabourMode(transcript) } };
  }
  if (c.action === "set_labour_hours" && c.args.mode !== "add" && c.args.mode !== "set") {
    return { ...r, action: c.action, args: { ...c.args, mode: labourModeFromText(transcript) } };
  }
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

/** Only when the words clearly say add vs set. */
export function explicitLabourMode(t: string): "add" | "set" | null {
  const s = (t || "").toLowerCase();
  if (/\b(set|make it|make that|change (it )?to|should be|total of|in total)\b/.test(s)) return "set";
  if (/\b(add|another|extra|plus)\b/.test(s)) return "add";
  return null;
}

const num = (s: string) => Number(s.replace(/[\s,]/g, "").replace(/\.(?=.*\.)/g, ""));
const clean = (s: string) => s.trim().replace(/[.!?]+$/, "").replace(/^(the|my)\s+/i, "").trim();

/**
 * Verb-pattern guards: when the words unmistakably name an action, correct a
 * wrong pick (e.g. rename for "describe", add_area for "add a note").
 * Plans (2+ edits) are left to the plan path.
 */
export function guardRoute(r: RouteResult, transcript: string): RouteResult {
  const t = (transcript || "").trim();
  if (!t || r.action === "run_plan") return r;
  const pick = (action: string, args: Record<string, unknown>): RouteResult => {
    if (r.action === action) return { ...r, args: { ...r.args, ...args } };
    const am = r.assistantMessage as any;
    const fixedMsg = am?.tool_calls?.[0]
      ? { ...am, tool_calls: [{ ...am.tool_calls[0], function: { ...am.tool_calls[0].function, name: action, arguments: JSON.stringify(args) } }] }
      : am;
    return { ...r, action, args, confidence: Math.max(r.confidence, 0.9), assistantMessage: fixedMsg };
  };
  let m: RegExpMatchArray | null;
  if (/^\s*(?:please\s+)?(?:undo(?:\s+(?:that|it|this|the\s+last(?:\s+change)?))?|take\s+(?:that|it)\s+back|revert\s+(?:the\s+|my\s+)?last\s+(?:change|edit))\s*[.!]?\s*$/i.test(t)) return pick("undo_last_change", {});
  if ((m = t.match(/^\s*describe\s+(.+?)\s+as\s+(.+)$/i))) return pick("describe_area", { area: clean(m[1]), description: clean(m[2]) });
  if ((m = t.match(/\b(?:edit|change|update|replace)\s+(?:the\s+)?note(?:\s+(?:about|on|for)\s+(.+?))?\s*(?:\s+to|\s+with|:)\s+(.+)$/i))) {
    return pick("edit_note", { ...(m[1] ? { match: clean(m[1]) } : {}), text: clean(m[2]) });
  }
  if ((m = t.match(/\b(?:remove|delete|clear|drop)\s+(?:the\s+|all\s+(?:the\s+)?)?notes?\b(?:\s+(?:about|on|for|from|saying)\s+(.+))?\s*$/i))) {
    return pick("remove_note", m[1] ? { match: clean(m[1]) } : {});
  }
  if ((m = t.match(/^\s*(?:remove|delete)\s+(?:the\s+)?area\s+(.+)$/i)) || (m = t.match(/^\s*(?:remove|delete)\s+(?:the\s+)?(.+?)\s+area\s*[.!?]?$/i))) {
    return pick("remove_area", { area: clean(m[1]) });
  }
  if ((m = t.match(/\b(?:add|put)\s+a\s+note(?:\s+to\s+(?:the\s+)?quote)?\s*[:,-]?\s*(.+)$/i)) || (m = t.match(/^\s*note\s*[:,-]\s*(.+)$/i))) {
    return pick("add_note", { target: "quote", text: clean(m[1]) });
  }
  if ((m = t.match(/^\s*(?:duplicate|copy)\s+(.+?)\s+(?:as|to|into)\s+(.+)$/i))) return pick("duplicate_area", { area: clean(m[1]), new_name: clean(m[2]) });
  if ((m = t.match(/\b(?:set|change|make)\s+(?:the\s+)?(.+?)\s+price\s+(?:to|at)\s+r?\s*([\d][\d\s,.]*)/i))) {
    return pick("set_line_price", { item: clean(m[1]), price: num(m[2]) });
  }
  if ((m = t.match(/^\s*move\s+(it|that|the same)\s+back\b/i))) return pick("move_item", { item: m[1].toLowerCase(), area: "back" });
  if ((m = t.match(/\b(add|set|make it)\s+(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b(?:\s+(?:of\s+)?labou?r)?(?:\s+(?:to|in|on|for)\s+(?:the\s+)?(.+))?$/i)) && /labou?r|hour/i.test(t) && !/\b(samsung|daikin|midea|lg|unit|kit)\b/i.test(t)) {
    return pick("set_labour_hours", { area: clean(m[3] || String(r.args.area || "")), hours: Number(m[2]), mode: m[1].toLowerCase() === "add" ? "add" : "set" });
  }
  return r;
}
