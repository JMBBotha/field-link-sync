/**
 * Archive gaps (preview). Pure rules shared by Open leads, the pipeline,
 * the invoice ageing report, and the public-link page.
 *
 * Closing or dismissing a lead does not archive the quote and does not change
 * its status. The quote leaves Open leads and the open pipeline stages
 * (draft, sent, viewed, accepted). A live invoice or a booked job keeps it.
 * restore_lead clears closed_at / dismissed_at, so the quote comes back.
 */

export const OPEN_PIPELINE_STAGES = ["draft", "sent", "viewed", "accepted"] as const;

export const AGING_DEAD = new Set(["void", "cancelled", "canceled", "paid"]);

/** Reason written by quote_aging_sweep. Days come from sales_automation_settings.archive_after_days. */
export function autoArchiveReason(days: number | null | undefined): string {
  const n = Number(days);
  const used = Number.isFinite(n) && n > 0 ? Math.round(n) : 60;
  return `Auto-archived: ${used} days no activity`;
}

const LEGACY_AUTO = [/^Auto: Cold/i, /^Auto-archived:/i];

/** Flag first. Older rows still match the reasons the sweep actually wrote. */
export function isAutoArchive(row: { auto_archived?: boolean | null; archive_reason?: string | null }): boolean {
  if (row.auto_archived) return true;
  const reason = row.archive_reason || "";
  return LEGACY_AUTO.some((re) => re.test(reason));
}

export function leadIsClosedOrDismissed(lead?: { closed_at?: string | null; dismissed_at?: string | null } | null): boolean {
  return !!(lead?.closed_at || lead?.dismissed_at);
}

/**
 * True when this quote should leave Open leads and the open pipeline stages.
 * Booked jobs and quotes with a live invoice stay where they are.
 */
export function quoteHiddenByClosedLead(input: {
  leadClosed: boolean;
  stage: string;
  invoiced: boolean;
  booked: boolean;
}): boolean {
  if (!input.leadClosed || input.invoiced || input.booked) return false;
  return (OPEN_PIPELINE_STAGES as readonly string[]).includes(input.stage);
}

/** Same exclusions as the Home tiles' usableInvoice, plus paid and a due date, for get_invoice_aging_report. */
export function invoiceInAgingReport(inv: { status?: string | null; archived_at?: string | null; due_date?: string | null }): boolean {
  if (inv.archived_at) return false;
  if (!inv.due_date) return false;
  return !AGING_DEAD.has(String(inv.status || "").toLowerCase());
}

export function daysPastDue(dueDate: string, today: string): number {
  const due = Date.parse(`${dueDate.slice(0, 10)}T00:00:00Z`);
  const now = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  return Math.round((now - due) / 86_400_000);
}

/** Brackets from get_invoice_aging_report (current date minus due date). */
export function agingBracketLabel(days: number): string {
  if (days <= 30) return "0-30 days";
  if (days <= 60) return "31-60 days";
  if (days <= 90) return "61-90 days";
  return "91+ days";
}

export const AGING_BRACKETS = ["0-30 days", "31-60 days", "61-90 days", "91+ days"] as const;

export function summariseInvoiceAging(
  invoices: { status?: string | null; archived_at?: string | null; due_date?: string | null; outstanding?: number | null }[],
  today: string,
): { bracket: string; count: number; outstanding: number }[] {
  const buckets = new Map<string, { count: number; outstanding: number }>();
  for (const label of AGING_BRACKETS) buckets.set(label, { count: 0, outstanding: 0 });
  for (const inv of invoices) {
    if (!invoiceInAgingReport(inv) || !inv.due_date) continue;
    const label = agingBracketLabel(daysPastDue(inv.due_date, today));
    const row = buckets.get(label);
    if (!row) continue;
    row.count += 1;
    row.outstanding += Number(inv.outstanding) || 0;
  }
  return AGING_BRACKETS.map((bracket) => ({ bracket, ...buckets.get(bracket)! }));
}

export const PUBLIC_UNAVAILABLE = "This is no longer available. Please contact us.";
