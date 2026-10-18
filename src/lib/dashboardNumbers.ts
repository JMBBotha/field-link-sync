/** R4 dashboard number row: pure rules (one place). Limit tiles: lower is better; goal tiles: progress only. */
export type Goals = { depositLimit: number; followupLimit: number; revenueGoal: number; jobsGoal: number; visitsGoal: number };
export const DEFAULT_GOALS: Goals = { depositLimit: 0, followupLimit: 3, revenueGoal: 400000, jobsGoal: 10, visitsGoal: 10 };
export function goalsFrom(raw: unknown): Goals {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_GOALS };
  (Object.keys(DEFAULT_GOALS) as (keyof Goals)[]).forEach((k) => {
    const v = Number(r[k]);
    if (r[k] !== undefined && r[k] !== null && r[k] !== "" && Number.isFinite(v) && v >= 0) out[k] = v;
  });
  return out;
}

export type Tone = "neutral" | "amber" | "red";
/** Red past the limit; amber at the limit (or one below it when the limit is above 1); otherwise neutral. */
export function limitTone(value: number, limit: number): Tone {
  if (value > limit) return "red";
  if (limit > 0 && value >= Math.max(1, limit - 1)) return "amber";
  return "neutral";
}

export function changeLabel(now: number, before: number, period: string, money?: (n: number) => string) {
  const d = now - before;
  const abs = money ? money(Math.abs(d)) : String(Math.abs(d));
  return `${d > 0 ? "+" : d < 0 ? "−" : "±"}${abs} vs ${period}`;
}

/** Monday 00:00 of the week containing `d` (local = SAST on the box/phones). */
export function weekStart(d = new Date()) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return x;
}
export function monthStart(d = new Date()) { const x = new Date(d.getFullYear(), d.getMonth(), 1); return x; }
export const DAY = 86400000;

type DealLike = { stage?: string | null; depositDue?: boolean; quote: { accepted_at?: string | null; sent_at?: string | null; viewed_at?: string | null; updated_at?: string | null; status?: string | null } };

/** Installs awaiting deposit for more than 7 days (accepted, deposit still due). */
export function depositsWaiting(deals: DealLike[], now = Date.now(), olderThanDays = 7) {
  return deals.filter((d) => d.depositDue && d.quote.accepted_at && now - new Date(d.quote.accepted_at).getTime() > olderThanDays * DAY).length;
}
/** Quotes sent/viewed, not accepted or declined, with no activity for 5+ days. */
export function quotesNotFollowedUp(deals: DealLike[], now = Date.now(), olderThanDays = 5) {
  return deals.filter((d) => {
    const s = String(d.stage || d.quote.status || "").toLowerCase();
    if (!["sent", "viewed"].includes(s)) return false;
    const last = d.quote.updated_at || d.quote.viewed_at || d.quote.sent_at;
    return !!last && now - new Date(last).getTime() > olderThanDays * DAY;
  }).length;
}
