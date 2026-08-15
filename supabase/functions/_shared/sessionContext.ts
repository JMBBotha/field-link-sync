/**
 * Live UI context for the voice assistant.
 *
 * The browser reports what the operator currently has open (page, quote,
 * customer, last search). This is a HINT ONLY: it is never used for
 * authorisation. Every tool still resolves the caller from the signed session
 * / JWT and applies company scoping + RBAC server-side.
 */

// deno-lint-ignore no-explicit-any
type Db = any;

export interface UiContext {
  current_page?: string;
  route?: string;
  open_quote_id?: string;
  open_quote_number?: string;
  open_quote_status?: string;
  open_invoice_id?: string;
  open_job_id?: string;
  open_lead_id?: string;
  selected_customer_id?: string;
  selected_customer_name?: string;
  last_search_query?: string;
  notes?: string;
}

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const str = (v: unknown, max = 80): string | undefined => {
  if (typeof v !== "string") return undefined;
  const s = v.trim().slice(0, max);
  return s ? s : undefined;
};
const id = (v: unknown): string | undefined => {
  const s = str(v, 64);
  return s && uuidRe.test(s) ? s : undefined;
};

/** Strip anything unexpected and cap the payload so it stays small and fast. */
export function sanitizeContext(raw: unknown): UiContext {
  const c = (raw ?? {}) as Record<string, unknown>;
  const out: UiContext = {
    current_page: str(c.current_page, 40),
    route: str(c.route, 120),
    open_quote_id: id(c.open_quote_id),
    open_quote_number: str(c.open_quote_number, 40),
    open_quote_status: str(c.open_quote_status, 30),
    open_invoice_id: id(c.open_invoice_id),
    open_job_id: id(c.open_job_id),
    open_lead_id: id(c.open_lead_id),
    selected_customer_id: id(c.selected_customer_id),
    selected_customer_name: str(c.selected_customer_name, 80),
    last_search_query: str(c.last_search_query, 80),
    notes: str(c.notes, 160),
  };
  for (const k of Object.keys(out) as (keyof UiContext)[]) {
    if (out[k] === undefined) delete out[k];
  }
  return out;
}

/** Human-readable one-liner block injected into the prompt / tool results. */
export function describeContext(ctx: UiContext | null | undefined): string {
  if (!ctx || Object.keys(ctx).length === 0) return "Unknown — the operator has not opened anything specific yet.";
  const parts: string[] = [];
  if (ctx.current_page) parts.push(`on the ${ctx.current_page} screen`);
  if (ctx.open_quote_number || ctx.open_quote_id) {
    const ref = ctx.open_quote_number ?? "a quote";
    parts.push(`with quote ${ref}${ctx.open_quote_status ? ` (status ${ctx.open_quote_status})` : ""} open`);
  }
  if (ctx.open_invoice_id) parts.push("with an invoice open");
  if (ctx.open_job_id) parts.push("with a job open");
  if (ctx.open_lead_id) parts.push("with a lead open");
  if (ctx.selected_customer_name) parts.push(`looking at the customer ${ctx.selected_customer_name}`);
  if (ctx.last_search_query) parts.push(`last search was "${ctx.last_search_query}"`);
  if (ctx.notes) parts.push(ctx.notes);
  return parts.length ? parts.join(", ") : "Unknown.";
}

export async function saveSessionContext(
  db: Db,
  sessionId: string,
  userId: string,
  companyId: string,
  raw: unknown,
): Promise<UiContext> {
  const context = sanitizeContext(raw);
  if (!sessionId) return context;
  await db.from("voice_session_context").upsert({
    session_id: sessionId,
    user_id: userId,
    company_id: companyId,
    context,
    updated_at: new Date().toISOString(),
  }, { onConflict: "session_id" });
  return context;
}

export async function loadSessionContext(
  db: Db,
  sessionId: string,
  userId: string,
  companyId: string,
): Promise<UiContext | null> {
  if (!sessionId) return null;
  const { data } = await db.from("voice_session_context")
    .select("context")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .maybeSingle();
  return (data?.context as UiContext | undefined) ?? null;
}
