/**
 * Open leads on admin Home. Counting stays in countSales; this file is the
 * invoice, age, and who-may-archive rules those rows share.
 *
 * Age is a fixed 30 days since the latest stored activity (OPEN_LEAD_STALE_DAYS).
 * sales_automation_settings.cold_after_days / archive_after_days is a different
 * switch: it can auto-archive sent quotes when quote_aging_enabled is on.
 * This list never archives by itself.
 */
import type { HomeQuote } from "@/lib/adminHomeCount";

export const OPEN_LEAD_STALE_DAYS = 30;
const DAY_MS = 86_400_000;
const DEAD_INVOICE = new Set(["void", "cancelled", "canceled"]);

export type OpenLeadInvoice = {
  id?: string | null;
  quote_id?: string | null;
  lead_id?: string | null;
  status?: string | null;
  archived_at?: string | null;
};

export type OpenLeadJobLink = {
  quote_id?: string | null;
  lead_id?: string | null;
  invoice_id?: string | null;
  status?: string | null;
};

/** Live invoices (not void, cancelled, or archived) and jobs that point at one. */
export function invoicedKeys(
  invoices: OpenLeadInvoice[] | undefined,
  jobs: OpenLeadJobLink[] | undefined,
): { quotes: Set<string>; leads: Set<string> } {
  const quotes = new Set<string>();
  const leads = new Set<string>();
  const deadInvoiceIds = new Set<string>();
  for (const inv of invoices || []) {
    const dead = !!inv.archived_at || DEAD_INVOICE.has(String(inv.status || "").toLowerCase());
    if (inv.id && dead) deadInvoiceIds.add(inv.id);
    if (dead) continue;
    if (inv.quote_id) quotes.add(inv.quote_id);
    if (inv.lead_id) leads.add(inv.lead_id);
  }
  for (const job of jobs || []) {
    if (!job.invoice_id || deadInvoiceIds.has(job.invoice_id)) continue;
    if (job.quote_id) quotes.add(job.quote_id);
    if (job.lead_id) leads.add(job.lead_id);
  }
  return { quotes, leads };
}

export function quoteIsInvoiced(
  quote: { id: string; lead_id?: string | null },
  keys: { quotes: Set<string>; leads: Set<string> },
): boolean {
  return keys.quotes.has(quote.id) || (!!quote.lead_id && keys.leads.has(quote.lead_id));
}

/** Newest timestamp. Missing or unreadable values are skipped. */
export function latestActivity(dates: (string | null | undefined)[]): string | null {
  let best = -Infinity;
  let iso: string | null = null;
  for (const value of dates) {
    if (!value) continue;
    const t = Date.parse(value);
    if (!Number.isFinite(t) || t <= best) continue;
    best = t;
    iso = new Date(t).toISOString();
  }
  return iso;
}

export function quoteActivity(quote: Pick<HomeQuote, "created_at" | "updated_at" | "sent_at" | "viewed_at" | "accepted_at" | "declined_at">): string | null {
  return latestActivity([quote.updated_at, quote.sent_at, quote.viewed_at, quote.accepted_at, quote.declined_at, quote.created_at]);
}

/** True once the last activity is older than `days` (default 30). Exactly 30 days is not old yet. */
export function openLeadIsStale(lastIso: string | null | undefined, now: Date, days = OPEN_LEAD_STALE_DAYS): boolean {
  if (!lastIso) return false;
  const t = Date.parse(lastIso);
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t > days * DAY_MS;
}

/**
 * Quote archive is admin-only (quote_archive). A lead with no quote uses
 * can_close_lead: an admin, or the owning salesperson (and an unassigned lead).
 */
export function canArchiveOpenLead(
  row: { kind: "lead" | "quote"; ownerId: string | null },
  actor: { isAdmin: boolean; isSalesRep: boolean; userId: string | null },
): boolean {
  if (actor.isAdmin) return true;
  if (row.kind !== "lead" || !actor.isSalesRep || !actor.userId) return false;
  return !row.ownerId || row.ownerId === actor.userId;
}
