/**
 * Mandy server-side policy (Johan 13 Oct 2026). ONE shared definition for every company.
 * - Role-scoped tool allowlist: the server drops any tool the caller's tier may not use,
 *   whatever the browser sends. Unknown tools are denied by default.
 * - Never: system settings, pricing rules, catalogue, templates, users/roles.
 * - Shared tone (friendly, professional, firm; never threatening) with per-company name.
 * Tools still EXECUTE in the browser under the user's own JWT, so RLS stays the real guard.
 */
export type MandyTier = "admin" | "office" | "sales" | "tech" | "viewer";

const NAV_READ = [
  "open_calendar_day", "list_todays_jobs", "open_live_map", "filter_map_by_status",
];
const CLIENT_READ = ["find_client", "open_quote", "open_last_quote", "open_latest_quote", "open_top_quote", "read_quote_total", "read_install", "read_labour", "generate_quote_pdf"];
const QUOTE_WRITE = [
  "create_quote_for_client", "add_area", "rename_area", "describe_area", "duplicate_area", "remove_area",
  "add_item_to_area", "set_qty", "set_line_price", "move_item", "edit_install", "set_kit_length",
  "set_labour_hours", "remove_labour", "remove_item", "add_note", "edit_note", "remove_note",
  "clear_quote", "undo_last_change", "run_plan",
];
const MONEY = ["open_invoice", "show_deposit_due", "create_deposit_invoice",
  "list_overdue_invoices", "record_payment", "whatsapp_invoice", "create_purchase_orders", "list_purchase_orders",
  "list_payment_followups", "open_payment_followups", "request_payment_followup", "send_approved_followup"];
const JOBS = ["list_my_jobs", "open_job", "start_job"];
const OFFICE_JOBS = ["open_scheduler"];
const SEND_QUOTE = ["whatsapp_quote"];

export const TIER_TOOLS: Record<MandyTier, ReadonlySet<string>> = {
  admin: new Set([...NAV_READ, ...CLIENT_READ, ...QUOTE_WRITE, ...MONEY, ...JOBS, ...OFFICE_JOBS, ...SEND_QUOTE]),
  office: new Set([...NAV_READ, ...CLIENT_READ, ...QUOTE_WRITE, ...MONEY, ...JOBS, ...OFFICE_JOBS, ...SEND_QUOTE]),
  sales: new Set([...NAV_READ, ...CLIENT_READ, ...QUOTE_WRITE, ...SEND_QUOTE]),
  tech: new Set([...NAV_READ, ...JOBS]),
  viewer: new Set([...NAV_READ, ...CLIENT_READ, "list_my_jobs"]),
};

/** Hard deny, whatever tier or future tool list says. */
const SYSTEM_DENY = /(setting|pricing|price_rule|markup|margin|catalog|template|(^|_)users?($|_)|(^|_)roles?($|_)|permission|notification|labour_rate|subscription|plan_limit|migration|rls|signup)/i;
export const isSystemTool = (name: string) => SYSTEM_DENY.test(name);

export function tierFor(roles: string[], flags: { salesRep?: boolean; techOnly?: boolean }): MandyTier {
  if (flags.techOnly) return "tech";
  if (flags.salesRep) return "sales";
  if (roles.some((r) => r === "admin" || r === "platform_super_admin" || r === "platform_ops")) return "admin";
  if (roles.includes("dispatcher")) return "office";
  if (roles.includes("field_agent")) return "tech";
  return "viewer";
}

export function toolAllowed(tier: MandyTier, name: string): boolean {
  if (!name || isSystemTool(name)) return false;
  return TIER_TOOLS[tier].has(name);
}

const toolName = (t: unknown): string => {
  const o = t as { function?: { name?: unknown }; name?: unknown };
  return String(o?.function?.name ?? o?.name ?? "");
};

/** Keep only allowed tools; report the dropped names for the audit log. */
export function filterTools(tier: MandyTier, tools: unknown[]): { kept: unknown[]; dropped: string[] } {
  const kept: unknown[] = []; const dropped: string[] = [];
  for (const t of tools) (toolAllowed(tier, toolName(t)) ? kept : dropped).push(t as never);
  return { kept, dropped: dropped.map(toolName) };
}

/** A routed call is allowed only if the action (and every run_plan step) is allowed. */
export function routedCallAllowed(tier: MandyTier, action: string | null, args: Record<string, unknown>): boolean {
  if (!action) return true;
  if (!toolAllowed(tier, action)) return false;
  if (action === "run_plan") {
    const steps = Array.isArray(args?.steps) ? args.steps as Array<Record<string, unknown>> : [];
    return steps.every((s) => toolAllowed(tier, String(s?.action ?? s?.name ?? "")));
  }
  return true;
}

/** Five Grok voices a company can choose from. "liora" stays the default. */
export const MANDY_VOICES = ["liora", "eve", "ara", "rex", "leo"] as const;
export type MandyVoice = typeof MANDY_VOICES[number];
export const safeVoice = (v: unknown): MandyVoice =>
  (MANDY_VOICES as readonly string[]).includes(String(v)) ? (String(v) as MandyVoice) : "liora";

export const safeBotName = (n: unknown): string => {
  const s = String(n ?? "").replace(/[^\p{L}\p{N} '\-]/gu, "").trim().slice(0, 24);
  return s || "Mandy";
};

/** Shared tone block for every Mandy (flows down to all companies). */
export function toneBlock(botName: string, companyName: string): string {
  return `Identity and tone (applies to every company, set by the main system):
- You are ${botName}, the in-app work assistant for ${companyName || "this company"}, a South African air-conditioning business on Field Lynk.
- Be friendly, professional and firm. Polite and clear, no waffle, and hold the line on rules ("I can't change pricing; that's set by the main system").
- Never threatening, never rude, never pressure clients. About money: soft, helpful and consistent. Never mention legal action, penalties or blacklisting.
- You cannot change system settings, pricing rules, the catalogue, templates, users or roles. If asked, say so in one sentence.
- Anything that goes to a client needs the user to tap "Send this?" on screen first.`;
}
