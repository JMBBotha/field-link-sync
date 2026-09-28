/**
 * Dashboard drill-downs: ONE pure filter per list, used by both the tile count
 * and the list it links to, so the number and the rows can't drift.
 * Dates are Africa/Johannesburg calendar days.
 */
import { todayInJohannesburg } from "@/lib/todaysJobs";

export type Period = "today" | "7d" | "30d" | "90d" | string; // or YYYY-MM

const DAY_MS = 86_400_000;

/** Johannesburg YYYY-MM-DD for a timestamp or plain date string. */
export function jhbDate(v?: string | null): string | null {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : todayInJohannesburg(d);
}

export function isValidPeriod(p?: string | null): p is Period {
  return !!p && (["today", "7d", "30d", "90d"].includes(p) || /^\d{4}-\d{2}$/.test(p));
}

/** today = same SAST day; Nd = rolling last N×24h (same as the 90-day pipeline window); YYYY-MM = that month. */
export function inPeriod(value: string | null | undefined, period: Period | null | undefined, now = new Date()): boolean {
  if (!period || !isValidPeriod(period)) return true;
  if (!value) return false;
  if (period === "today") return jhbDate(value) === todayInJohannesburg(now);
  if (/^\d{4}-\d{2}$/.test(period)) return (jhbDate(value) || "").startsWith(period);
  const days = Number(period.replace("d", ""));
  const t = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00+02:00`).getTime() : new Date(value).getTime();
  return t >= now.getTime() - days * DAY_MS;
}

export function parseList(v?: string | null): string[] {
  return (v || "").split(",").map((s) => s.trim().toLowerCase()).filter((s) => s && s !== "all");
}

// ───────── Quotes (/admin/quotes) ─────────
export type QuoteDoc = { kind: "estimate" | "proposal"; status: string | null; created_at: string | null };
export type QuoteFilters = { status: string[]; type: "estimate" | "proposal" | null; period: Period | null };

export function parseQuoteParams(p: URLSearchParams): QuoteFilters {
  const type = p.get("type");
  const period = p.get("period");
  return {
    status: parseList(p.get("status")),
    type: type === "estimate" || type === "proposal" ? type : null,
    period: isValidPeriod(period) ? period : null,
  };
}

export function filterQuoteDocs<T extends QuoteDoc>(docs: T[], f: Partial<QuoteFilters>, now = new Date()): T[] {
  return docs.filter((d) => {
    if (String(d.status || "").toLowerCase() === "superseded") return false;
    if (f.type && d.kind !== f.type) return false;
    if (f.status?.length && !f.status.includes(String(d.status || "").toLowerCase())) return false;
    if (f.period && !inPeriod(d.created_at, f.period, now)) return false;
    return true;
  });
}

// ───────── Invoices (/admin/invoices) ─────────
export type InvoiceState = "draft" | "sent" | "paid" | "overdue" | "unpaid";
export type InvoiceRow = { status: string | null; issue_date?: string | null; paid_date?: string | null };
export type InvoiceFilters = { state: InvoiceState | null; period: Period | null };

const STATES: InvoiceState[] = ["draft", "sent", "paid", "overdue", "unpaid"];

export function parseInvoiceParams(p: URLSearchParams): InvoiceFilters {
  const s = p.get("state") as InvoiceState | null;
  const period = p.get("period");
  return { state: s && STATES.includes(s) ? s : null, period: isValidPeriod(period) ? period : null };
}

/** unpaid = sent + overdue (same rule as the Outstanding card). */
export function matchesInvoiceState(status: string | null | undefined, state: InvoiceState | null): boolean {
  if (!state) return true;
  const s = String(status || "").toLowerCase();
  return state === "unpaid" ? s === "sent" || s === "overdue" : s === state;
}

export function filterInvoices<T extends InvoiceRow>(rows: T[], f: Partial<InvoiceFilters>, now = new Date()): T[] {
  return rows.filter((r) => {
    if (!matchesInvoiceState(r.status, f.state ?? null)) return false;
    if (f.period) {
      const d = f.state === "paid" ? r.paid_date : r.issue_date;
      if (!inPeriod(d ?? null, f.period, now)) return false;
    }
    return true;
  });
}

// ───────── Tile targets (one place) ─────────
export const TILE_LINKS = {
  todaysJobs: "/admin/jobs/dispatch?date=today",
  pendingQuotes: "/admin/quotes?status=draft&type=estimate",
  overdueInvoices: "/admin/invoices?state=overdue",
  activeTechs: "/admin/team",
  revenueToday: "/admin/invoices?state=paid&period=today",
  overdueMaintenance: "/admin/maintenance",
  jobsTotal: "/admin/jobs/dispatch",
  jobsActive: "/admin/jobs/dispatch?status=in_progress",
  jobsCompleted: "/admin/jobs/dispatch?status=completed",
  openQuotesValue: "/admin/quotes?status=draft,sent,pending,viewed&type=estimate",
  quotesWon90: "/admin/quotes?status=accepted&type=estimate&period=90d",
  quotesLost90: "/admin/quotes?status=declined,rejected&type=estimate&period=90d",
} as const;

export const PENDING_QUOTES_FILTER: Partial<QuoteFilters> = { status: ["draft"], type: "estimate" };
export const OVERDUE_INVOICES_FILTER: Partial<InvoiceFilters> = { state: "overdue" };
export const REVENUE_TODAY_FILTER: Partial<InvoiceFilters> = { state: "paid", period: "today" };

/** Remove one param (or all listed) and return the new params. */
export function clearParams(p: URLSearchParams, keys: string[]): URLSearchParams {
  const n = new URLSearchParams(p);
  keys.forEach((k) => n.delete(k));
  return n;
}

// ───────── Invoice spec aliases → existing money= filters ─────────
export type MoneyAlias = "deposits_due" | "partially_paid" | "outstanding";
/** money= wins; else kind=deposit&state=due → deposits_due, kind=deposit&state=partial → partially_paid. */
export function resolveMoneyFilter(p: URLSearchParams): MoneyAlias | null {
  const m = p.get("money");
  if (m === "deposits_due" || m === "partially_paid" || m === "outstanding") return m;
  if (p.get("kind") === "deposit") {
    if (p.get("state") === "due") return "deposits_due";
    if (p.get("state") === "partial") return "partially_paid";
  }
  return null;
}
export const MONEY_LABEL: Record<MoneyAlias, string> = { deposits_due: "Deposits due", partially_paid: "Partially paid", outstanding: "Outstanding" };

// ───────── Leads inbox ?lane= ─────────
export function parseLaneParam(p: URLSearchParams): "sales" | "service" | null {
  const l = p.get("lane");
  return l === "sales" || l === "service" ? l : null;
}
