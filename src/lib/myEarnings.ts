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
