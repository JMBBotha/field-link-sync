/**
 * Tech "My earnings" (Johan 09:27) — helpers over get_my_tech_earnings(): own rows only, labour share only.
 * No job prices, quote totals, invoices, percentages or anyone else's figures.
 */
export interface MyEarningRow {
  row_key: string; job_id: string | null; job_name: string; job_date: string | null; hours: number | null;
  kind: "completion" | "retention"; status: string; amount: number; release_after: string | null; paid_at: string | null;
}
export type MyBucket = "pending" | "paid" | "held" | "reduced";

/** pending = completion share not paid yet; paid = paid/released; held = retention not released yet. */
export function bucketOf(r: Pick<MyEarningRow, "kind" | "status">): MyBucket {
  if (r.status === "paid" || r.status === "released") return "paid";
  if (r.status === "reduced") return "reduced";
  return r.kind === "retention" ? "held" : "pending";
}
export const BUCKET_LABEL: Record<MyBucket, string> = { pending: "Pending", paid: "Paid", held: "Retention held", reduced: "Reduced (callback)" };

const r2 = (n: number) => Math.round(n * 100) / 100;
const sastToday = (now: Date) => new Date(now.toLocaleString("en-US", { timeZone: "Africa/Johannesburg" }));
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function summarizeMine(rows: MyEarningRow[], now = new Date()) {
  const t = sastToday(now);
  const monday = new Date(t); monday.setDate(t.getDate() - ((t.getDay() + 6) % 7));
  const weekFrom = ymd(monday), monthFrom = ymd(new Date(t.getFullYear(), t.getMonth(), 1)), today = ymd(t);
  const sum = (f: (r: MyEarningRow) => boolean) => r2(rows.filter(f).reduce((a, r) => a + (Number(r.amount) || 0), 0));
  const inRange = (r: MyEarningRow, from: string) => !!r.job_date && r.job_date >= from && r.job_date <= today;
  return {
    week: sum((r) => inRange(r, weekFrom)),
    month: sum((r) => inRange(r, monthFrom)),
    pending: sum((r) => bucketOf(r) === "pending"),
    paid: sum((r) => bucketOf(r) === "paid"),
    held: sum((r) => bucketOf(r) === "held"),
    count: rows.length,
  };
}

/** One line per job: name, date, hours, total share, and its parts. */
export function byJob(rows: MyEarningRow[]) {
  const m = new Map<string, { key: string; job_name: string; job_date: string | null; hours: number | null; total: number; parts: MyEarningRow[] }>();
  for (const r of rows) {
    const k = r.job_id ?? r.row_key;
    const e = m.get(k) ?? { key: k, job_name: r.job_name, job_date: r.job_date, hours: r.hours, total: 0, parts: [] };
    e.total = r2(e.total + (Number(r.amount) || 0)); e.parts.push(r);
    if (e.hours == null && r.hours != null) e.hours = r.hours;
    m.set(k, e);
  }
  return [...m.values()];
}

/** Monday (SAST calendar) of the week containing a YYYY-MM-DD date. */
export function weekStart(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  const dt = new Date(y, m - 1, day); dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return ymd(dt);
}
/** This month vs last month (by job date). */
export function monthCompare(rows: MyEarningRow[], now = new Date()) {
  const t = sastToday(now);
  const thisFrom = ymd(new Date(t.getFullYear(), t.getMonth(), 1));
  const lastFrom = ymd(new Date(t.getFullYear(), t.getMonth() - 1, 1));
  const sum = (f: (d: string) => boolean) => r2(rows.filter((r) => r.job_date && f(r.job_date)).reduce((a, r) => a + (Number(r.amount) || 0), 0));
  const current = sum((d) => d >= thisFrom && d <= ymd(t)), last = sum((d) => d >= lastFrom && d < thisFrom);
  return { current, last, diff: r2(current - last), trend: current > last ? "up" : current < last ? "down" : "same" as "up" | "down" | "same" };
}
/** Totals for the last `n` weeks (oldest first), current week last. */
export function lastWeeks(rows: MyEarningRow[], n = 8, now = new Date()) {
  const cur = weekStart(ymd(sastToday(now)));
  const weeks: { start: string; total: number }[] = [];
  for (let i = n - 1; i >= 0; i--) { const [y, m, d] = cur.split("-").map(Number); weeks.push({ start: ymd(new Date(y, m - 1, d - 7 * i)), total: 0 }); }
  for (const r of rows) {
    if (!r.job_date) continue;
    const w = weeks.find((x) => x.start === weekStart(r.job_date!));
    if (w) w.total = r2(w.total + (Number(r.amount) || 0));
  }
  return weeks;
}
/** Per-job lines grouped by week (newest week first); undated jobs last. */
export function jobsByWeek(rows: MyEarningRow[]) {
  const groups = new Map<string, ReturnType<typeof byJob>>();
  for (const j of byJob(rows)) {
    const k = j.job_date ? weekStart(j.job_date) : "undated";
    groups.set(k, [...(groups.get(k) ?? []), j]);
  }
  return [...groups].sort(([a], [b]) => (a === "undated" ? 1 : b === "undated" ? -1 : b.localeCompare(a)))
    .map(([start, jobs]) => ({ start, jobs, total: r2(jobs.reduce((a, j) => a + j.total, 0)) }));
}
