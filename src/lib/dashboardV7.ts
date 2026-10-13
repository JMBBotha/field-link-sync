/**
 * v7 dashboard maths (Johan 13 Oct 12:00). Pure functions only: period ranges in SAST, comparisons,
 * monthly buckets, aging and funnel. Used by the NEW layout only (Classic never imports this).
 */
export const TZ_MS = 2 * 3600_000; // Africa/Johannesburg, no DST
export type PeriodKind = "today" | "week" | "month" | "quarter" | "year" | "custom";
export type Range = { start: number; end: number }; // ms, [start, end)

const sast = (t: number) => new Date(t + TZ_MS);
const fromSast = (y: number, m: number, d: number) => Date.UTC(y, m, d) - TZ_MS;

export function periodRange(kind: PeriodKind, now: number, custom?: Range): Range {
  const d = sast(now); const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
  const end = now + 1;
  switch (kind) {
    case "today": return { start: fromSast(y, m, day), end };
    case "week": { const dow = (d.getUTCDay() + 6) % 7; return { start: fromSast(y, m, day - dow), end }; }
    case "month": return { start: fromSast(y, m, 1), end };
    case "quarter": return { start: fromSast(y, m - (m % 3), 1), end };
    case "year": return { start: fromSast(y, 0, 1), end };
    case "custom": return custom ?? { start: fromSast(y, m, 1), end };
  }
}

/** Same-length window straight before r ("prev"). */
export const prevRange = (r: Range): Range => ({ start: r.start - (r.end - r.start), end: r.start });
/** Shift a window by n calendar months in SAST (LM = -1, LY = -12), clamping the day. */
export function shiftMonths(r: Range, n: number): Range {
  const sh = (t: number) => {
    const d = sast(t); const y = d.getUTCFullYear(), m = d.getUTCMonth() + n;
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const ms = t + TZ_MS - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return Date.UTC(y, m, Math.min(d.getUTCDate(), last)) - TZ_MS + ms;
  };
  return { start: sh(r.start), end: sh(r.end) };
}

export const ts = (v?: string | null) => (v ? Date.parse(v.length <= 10 ? v + "T00:00:00+02:00" : v) : NaN);
export const inRange = (v: string | null | undefined, r: Range) => { const t = ts(v); return t >= r.start && t < r.end; };

export type DashRow = Record<string, any>;
export type DashData = { leads: DashRow[]; quotes: DashRow[]; invoices: DashRow[]; jobs: DashRow[]; commissions: DashRow[] | null };
export type MetricKey = "new_leads" | "quotes_sent" | "quotes_accepted" | "conversion" | "jobs_completed" | "invoiced" | "paid" | "commission";
export const METRICS: { key: MetricKey; label: string; money?: boolean; pct?: boolean; office?: boolean; owner?: boolean }[] = [
  { key: "new_leads", label: "New leads" },
  { key: "quotes_sent", label: "Quotes sent" },
  { key: "quotes_accepted", label: "Quotes accepted" },
  { key: "conversion", label: "Conversion", pct: true },
  { key: "jobs_completed", label: "Jobs completed" },
  { key: "invoiced", label: "Invoiced", money: true, office: true },
  { key: "paid", label: "Paid", money: true, office: true },
  { key: "commission", label: "Commission (team)", money: true, owner: true },
];

const NOT_ISSUED = new Set(["draft", "void", "cancelled", "credited"]);
const num = (v: any) => (typeof v === "number" ? v : Number(v) || 0);

export function metric(d: DashData, k: MetricKey, r: Range): number | null {
  switch (k) {
    case "new_leads": return d.leads.filter((l) => inRange(l.created_at, r)).length;
    case "quotes_sent": return d.quotes.filter((q) => inRange(q.sent_at, r)).length;
    case "quotes_accepted": return d.quotes.filter((q) => inRange(q.accepted_at, r)).length;
    case "conversion": { const s = metric(d, "quotes_sent", r)!; return s ? Math.round((metric(d, "quotes_accepted", r)! / s) * 100) : 0; }
    case "jobs_completed": return d.jobs.filter((j) => j.status === "completed" && inRange(j.completed_at, r)).length;
    case "invoiced": return d.invoices.filter((i) => !NOT_ISSUED.has(i.status) && inRange(i.issue_date, r)).reduce((a, i) => a + num(i.grand_total), 0);
    case "paid": return d.invoices.filter((i) => i.status === "paid" && inRange(i.paid_date, r)).reduce((a, i) => a + num(i.grand_total), 0);
    case "commission": return d.commissions ? d.commissions.filter((c) => inRange(c.earned_at || c.created_at, r)).reduce((a, c) => a + num(c.commission), 0) : null;
  }
}

/** % change, null when there is no base to compare against. */
export const delta = (cur: number | null, base: number | null) => (cur == null || base == null || base === 0 ? null : Math.round(((cur - base) / Math.abs(base)) * 100));

/** Last n SAST calendar months ending with the month of `now`. */
export function lastMonths(now: number, n = 12): (Range & { label: string })[] {
  const d = sast(now); const out: (Range & { label: string })[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const y = d.getUTCFullYear(), m = d.getUTCMonth() - i;
    const s = fromSast(y, m, 1), e = fromSast(y, m + 1, 1);
    out.push({ start: s, end: e, label: new Date(Date.UTC(y, m, 1)).toLocaleString("en-ZA", { month: "short", timeZone: "UTC" }) });
  }
  return out;
}

export function series(d: DashData, k: MetricKey, now: number, n = 12) { return lastMonths(now, n).map((m) => metric(d, k, m) ?? 0); }

/** Outstanding = issued, not paid. Buckets by days past due (falls back to issue date). */
export function aging(invoices: DashRow[], now: number) {
  const b = [{ label: "0–30 days", amount: 0 }, { label: "31–60 days", amount: 0 }, { label: "61–90 days", amount: 0 }, { label: "90+ days", amount: 0 }];
  for (const i of invoices) {
    if (NOT_ISSUED.has(i.status) || i.status === "paid") continue;
    const ref = ts(i.due_date) || ts(i.issue_date); const days = Number.isFinite(ref) ? Math.max(0, Math.floor((now - ref) / 86400_000)) : 0;
    b[days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : 3].amount += num(i.grand_total);
  }
  return b;
}
export const outstanding = (invoices: DashRow[]) => invoices.filter((i) => !NOT_ISSUED.has(i.status) && i.status !== "paid").reduce((a, i) => a + num(i.grand_total), 0);

/** Lead funnel for leads created in r: New → Contacted → Site visit → Quoted → Won. */
export function funnel(d: DashData, r: Range) {
  const leads = d.leads.filter((l) => inRange(l.created_at, r));
  const ids = new Set(leads.map((l) => l.id));
  const qs = d.quotes.filter((q) => q.lead_id && ids.has(q.lead_id));
  const quoted = new Set(qs.map((q) => q.lead_id)); const won = new Set(qs.filter((q) => q.status === "accepted" || q.accepted_at).map((q) => q.lead_id));
  return [
    { label: "New", value: leads.length },
    { label: "Contacted", value: leads.filter((l) => l.first_contact_at || num(l.contact_attempts) > 0).length },
    { label: "Site visit", value: leads.filter((l) => l.scheduled_date).length },
    { label: "Quoted", value: quoted.size },
    { label: "Won", value: won.size },
  ];
}

export type JobBucket = "overdue" | "scheduled" | "in_progress" | "waiting" | "completed";
export function jobBuckets(jobs: DashRow[], now: number): Record<JobBucket, number> {
  const out: Record<JobBucket, number> = { overdue: 0, scheduled: 0, in_progress: 0, waiting: 0, completed: 0 };
  for (const j of jobs) {
    if (j.status === "cancelled") continue;
    if (j.status === "completed") out.completed++;
    else if (j.awaiting_stock) out.waiting++;
    else if (["in_progress", "en_route", "on_site", "started"].includes(j.status)) out.in_progress++;
    else if (j.scheduled_for && ts(j.scheduled_for) < now - 86400_000) out.overdue++;
    else out.scheduled++;
  }
  return out;
}

export const rand = (v: number) => "R " + Math.round(v).toLocaleString("en-ZA").replace(/,/g, " ");
