/**
 * Open leads on admin Home. Counting stays in countSales; this file is the
 * invoice, age, and who-may-archive rules those rows share.
 *
 * Defaults match sales_automation_settings: warn (cold_after_days) 30,
 * auto-archive (archive_after_days) 60. A company row overrides them.
 * The home card only warns. Auto-archive is the daily quote_aging_sweep.
 *
 * Activity already stored on the row:
 * quote = latest of updated_at (edits, status changes, follow-up writes),
 * sent_at (send/resend), viewed_at, accepted_at, declined_at, created_at.
 * lead = latest of last_activity_at (notes, calls, status) and created_at.
 * The sweep also takes the latest quote_followups.created_at and the linked
 * lead's last_activity_at so a call log counts even if updated_at did not move.
 */
import type { HomeQuote } from "@/lib/adminHomeCount";

/** Shown as "Old — archive?" once activity is older than this. Company setting overrides it. */
export const OPEN_LEAD_STALE_DAYS = 30;
/** Server auto-archive once activity is older than this, when quote ageing is on. */
export const OPEN_LEAD_ARCHIVE_DAYS = 60;
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

export function quoteActivity(quote: Pick<HomeQuote, "created_at" | "updated_at" | "sent_at" | "viewed_at" | "accepted_at" | "declined_at"> & { followup_at?: string | null; lead_activity_at?: string | null }): string | null {
  return latestActivity([quote.updated_at, quote.sent_at, quote.viewed_at, quote.accepted_at, quote.declined_at, quote.created_at, quote.followup_at, quote.lead_activity_at]);
}

const AUTO_QUOTE = new Set(["draft", "sent", "viewed"]);

/** Same rule as open_lead_auto_archive_preview in the ageing migration. */
export function shouldAutoArchiveOpenLead(input: {
  kind: "quote" | "lead";
  status?: string | null;
  archived?: boolean;
  invoiced?: boolean;
  /** Accepted quote that already has a job which is not cancelled. */
  acceptedWithLiveJob?: boolean;
  /** Pending lead that already has a quote. */
  hasQuote?: boolean;
  lastActivity?: string | null;
  now: Date;
  archiveAfterDays?: number;
}): boolean {
  if (input.archived || input.invoiced || input.acceptedWithLiveJob) return false;
  const status = String(input.status || "").toLowerCase();
  if (input.kind === "quote") {
    if (!AUTO_QUOTE.has(status)) return false;
  } else if (status !== "pending" || input.hasQuote) return false;
  const days = input.archiveAfterDays ?? OPEN_LEAD_ARCHIVE_DAYS;
  return openLeadIsStale(input.lastActivity, input.now, days);
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
