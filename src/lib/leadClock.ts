// Two-stage lead clock (pure). Stage 1: arrival -> first contact (call reached / WhatsApp).
// Stage 2: first contact -> quote sent (sales) / visit booked (service). Business hours are SAST (UTC+2, no DST)
// and mirror public.lead_sla_next_open / check_lead_sla in the DB (pg_cron escalations).
export type SlaSettings = { enabled: boolean; contactMinutes: number; workDays: number[]; open: string; close: string; amber: string };
export const DEFAULT_SLA: SlaSettings = { enabled: true, contactMinutes: 5, workDays: [1, 2, 3, 4, 5], open: "08:00", close: "17:00", amber: "15:00" };
export type Tone = "green" | "yellow" | "orange" | "red" | "blue" | "amber" | "grey" | "done";
export type LeadClockInput = {
  created_at?: string | null; first_contact_at?: string | null; stage2_done_at?: string | null; status?: string | null;
  primary_intent?: string | null; sla_breached_at?: string | null; quote_sla_breached_at?: string | null;
};
export type LeadClock = { stage: 0 | 1 | 2 | 3; tone: Tone; big: string; sub: string; alerted: string | null; stage2Label: "Quote" | "Visit" };

const TZ = 2 * 3600_000;
const DAY = 86400_000;
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const localDay = (t: number) => Math.floor((t + TZ) / DAY);
const isoDow = (day: number) => ((day + 3) % 7) + 1; // 1970-01-01 was a Thursday
const at = (day: number, hhmm: string) => day * DAY + toMin(hhmm) * 60_000 - TZ;

export const mmss = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
export const hm = (ms: number) => { const m = Math.max(0, Math.floor(ms / 60000)); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
export const hhmm = (t: number | string) => { const d = new Date((typeof t === "string" ? Date.parse(t) : t) + TZ); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };

/** Clock start: t itself inside business hours, otherwise the next opening. */
export function nextOpen(t: number, s: SlaSettings = DEFAULT_SLA): number {
  const d0 = localDay(t);
  for (let i = 0; i < 14; i++) {
    const d = d0 + i;
    if (!s.workDays.includes(isoDow(d))) continue;
    if (i > 0) return at(d, s.open);
    if (t < at(d, s.open)) return at(d, s.open);
    if (t < at(d, s.close)) return t;
  }
  return t;
}

export function leadClock(l: LeadClockInput, now: number, s: SlaSettings = DEFAULT_SLA): LeadClock | null {
  if (!s.enabled || !l.created_at || (l.status && l.status !== "pending")) return null;
  const stage2Label = l.primary_intent === "service" ? "Visit" : "Quote";
  const base = { stage2Label } as const;
  if (l.stage2_done_at) return { ...base, stage: 3, tone: "done", big: "✓", sub: `${stage2Label === "Visit" ? "Visit booked" : "Quote sent"} ${hhmm(l.stage2_done_at)}`, alerted: null };
  if (!l.first_contact_at) {
    const start = nextOpen(Date.parse(l.created_at), s);
    if (now < start) return { ...base, stage: 0, tone: "grey", big: `Starts ${s.open}`, sub: "arrived after hours", alerted: null };
    const el = now - start, target = s.contactMinutes * 60_000, f = el / target;
    return {
      ...base, stage: 1,
      tone: f < 0.4 ? "green" : f < 0.8 ? "yellow" : f < 1 ? "orange" : "red",
      big: el < 3600_000 ? mmss(el) : hm(el),
      sub: el < target ? `call within ${mmss(target - el)}` : `${Math.floor((el - target) / 60000)} min over target`,
      alerted: l.sla_breached_at ? `Owner alerted ${hhmm(l.sla_breached_at)}` : null,
    };
  }
  const start2 = nextOpen(Date.parse(l.first_contact_at), s), day = localDay(start2);
  const due = at(day, s.close), amber = at(day, s.amber), what = stage2Label.toLowerCase();
  return {
    ...base, stage: 2,
    tone: now >= due ? "red" : now >= amber ? "amber" : "blue",
    big: now < start2 ? `Due ${s.close}` : hm(now - start2),
    sub: now < due ? `${what} due by ${s.close} (${hm(due - now)})` : `${what} overdue since ${s.close}`,
    alerted: l.quote_sla_breached_at ? `#2 alerted ${hhmm(l.quote_sla_breached_at)}` : null,
  };
}
