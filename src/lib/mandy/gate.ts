/**
 * Tiered confidence gate — one pure function decides whether a routed action
 * runs, needs chips, needs an on-screen Confirm card, or is blocked.
 */

export const LOW_RISK_MIN = 0.5;
export const PRICED_MIN = 0.7;

/** Draft-quote edits that don't change prices directly. */
export const LOW_RISK_EDITS = new Set([
  "set_labour_hours", "add_area", "rename_area", "describe_area", "add_note", "edit_note", "set_qty", "move_item", "duplicate_area",
  // remove_area: the handler itself returns a Confirm card when the area has lines.
  "remove_area",
  // Undo restores the last Mandy snapshot; drafts only (handler + QUOTE_WRITES block).
  "undo_last_change",
]);
/** Priced adds / changes. */
export const PRICED_ACTIONS = new Set(["add_item_to_area", "add_unit", "add_kit", "set_kit_length", "set_line_price", "edit_install"]);
/** Always a Confirm card, whatever the confidence. */
export const ALWAYS_CONFIRM = new Set([
  "remove_item", "remove_note", "remove_labour", "clear_quote", "create_deposit_invoice", "send_quote", "send_invoice", "email_quote", "whatsapp_quote", "delete_quote", "accept_quote",
]);
/** Reads and navigation — allowed on any quote. */
export const READ_ONLY = new Set([
  "open_last_quote", "open_latest_quote", "open_top_quote", "open_quote", "find_client", "open_client", "select_client", "add_new_client",
  "open_invoice", "show_deposit_due", "open_calendar_day", "list_todays_jobs", "open_live_map", "filter_map_by_status",
  "read_quote_total", "read_labour", "generate_quote_pdf",
]);
/** Actions that change the open quote. */
const QUOTE_WRITES = new Set([...LOW_RISK_EDITS, ...PRICED_ACTIONS, "remove_item", "remove_note", "remove_labour", "send_quote", "email_quote", "whatsapp_quote", "accept_quote", "delete_quote"]);

export interface GateCtx {
  /** Status of the open quote, if any (null = no quote open). */
  quoteStatus?: string | null;
  /** The action would set a price below list/floor. */
  belowFloor?: boolean;
}

export type GateKind = "run" | "chips" | "confirm" | "block";
export interface GateResult { kind: GateKind; threshold: number; reason?: string }

export function gateDecision(action: string, confidence: number, ctx: GateCtx = {}): GateResult {
  const status = (ctx.quoteStatus || "").toLowerCase();
  const nonDraft = !!ctx.quoteStatus && status !== "draft";
  if (nonDraft && QUOTE_WRITES.has(action)) {
    return { kind: "block", threshold: 1, reason: `This quote is ${status}, so it's read-only.` };
  }
  if (ALWAYS_CONFIRM.has(action) || ctx.belowFloor) return { kind: "confirm", threshold: 0 };
  const threshold = READ_ONLY.has(action) || LOW_RISK_EDITS.has(action) ? LOW_RISK_MIN : PRICED_MIN;
  return { kind: confidence >= threshold ? "run" : "chips", threshold };
}

/* Open-quote status, published by the quote page while its actions are mounted. */
let currentQuoteStatus: string | null = null;
export const setMandyQuoteStatus = (s: string | null) => { currentQuoteStatus = s; };
export const getMandyQuoteStatus = () => currentQuoteStatus;

/**
 * Plan gate: the plan as a whole is gated once — lowest confidence and the
 * highest-risk step decide. A runnable plan ALWAYS goes to the single Confirm
 * card (kind "confirm"); below the plan's threshold it becomes chips; any
 * write on a non-draft quote blocks the whole plan.
 */
export function gatePlan(steps: { action: string }[], confidence: number, ctx: GateCtx = {}): GateResult {
  if (!steps.length) return { kind: "block", threshold: 1, reason: "That plan had no steps I can run." };
  let threshold = 0;
  for (const s of steps) {
    const g = gateDecision(s.action, 1, ctx);
    if (g.kind === "block") return g;
    const t = ALWAYS_CONFIRM.has(s.action) ? PRICED_MIN : READ_ONLY.has(s.action) || LOW_RISK_EDITS.has(s.action) ? LOW_RISK_MIN : PRICED_MIN;
    threshold = Math.max(threshold, t);
  }
  return { kind: confidence >= threshold ? "confirm" : "chips", threshold };
}
