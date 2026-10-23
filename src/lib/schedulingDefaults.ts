/**
 * Scheduling defaults — mirrored in SQL (public.default_booking_minutes,
 * booking_clashes). Change both together.
 */
export const WORK_DAYS = [1, 2, 3, 4, 5]; // Mon–Fri
export const WORK_START = "08:00";
export const WORK_END = "17:00";
export const TRAVEL_BUFFER_MIN = 30;

/** Johan 23 Oct 2026: 3h default for every job; sales visits stay 1h; quote labour wins when present. */
export const DEFAULT_JOB_MINUTES = 180;
export const DEFAULT_MINUTES = {
  installationPerUnit: DEFAULT_JOB_MINUTES,
  service: DEFAULT_JOB_MINUTES,
  repair: DEFAULT_JOB_MINUTES,
  salesVisit: 60,
} as const;
/** Longest single-day booking (minutes). Longer work becomes multi-day (phase b). */
export const MAX_SINGLE_DAY_MINUTES = 24 * 60 - 1;

/** "14:00:00" | "14:00" | "9:5" → "14:00" / "09:05". Empty → "". */
export function hhmm(t: string | null | undefined): string {
  if (!t) return "";
  const [h, m] = String(t).split(":");
  if (h === undefined || isNaN(Number(h))) return String(t);
  return `${String(Number(h)).padStart(2, "0")}:${String(Number(m || 0)).padStart(2, "0")}`;
}

export function toMinutes(t: string | null | undefined): number {
  if (!t) return 0;
  const [h, m] = String(t).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function fromMinutes(mins: number): string {
  const c = Math.max(0, Math.min(mins, 23 * 60 + 59));
  return `${String(Math.floor(c / 60)).padStart(2, "0")}:${String(c % 60).padStart(2, "0")}`;
}

/** Postgres interval text ("03:30:00", "2 hours", "01:00") → minutes; null when unknown. */
export function intervalToMinutes(v: string | null | undefined): number | null {
  if (!v) return null;
  const s = String(v);
  const hm = s.match(/(\d+):(\d{2})(?::\d{2})?/);
  let mins = 0;
  const days = s.match(/(\d+)\s*day/);
  if (days) mins += Number(days[1]) * 1440;
  if (hm) mins += Number(hm[1]) * 60 + Number(hm[2]);
  else {
    const h = s.match(/([\d.]+)\s*hour/); const m = s.match(/(\d+)\s*min/);
    if (h) mins += Math.round(Number(h[1]) * 60);
    if (m) mins += Number(m[1]);
  }
  return mins > 0 ? mins : null;
}

export function minutesToInterval(mins: number): string {
  return `${Math.round(mins)} minutes`;
}

/**
 * Default booking length in minutes.
 * kind: job_type / service_type / lane ("sales", "installation", "repair", ...).
 */
export function isSalesKind(kind?: string | null): boolean {
  const k = String(kind || "").toLowerCase().trim();
  return k.includes("sales") || k.includes("quote") || k.includes("consult") || k === "survey";
}

/** Flat 3h for jobs (install, repair, service, unknown), 1h for sales visits. `units` kept for callers; no longer multiplies. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function defaultMinutes(kind?: string | null, _units = 1): number {
  return isSalesKind(kind) ? DEFAULT_MINUTES.salesVisit : DEFAULT_JOB_MINUTES;
}

/** Quote labour hours → booking minutes (min 30, max one day). null when no labour. */
export function quoteLabourMinutes(hours: number | null | undefined): number | null {
  const h = Number(hours);
  if (!h || !isFinite(h) || h <= 0) return null;
  return Math.min(Math.max(Math.round((h * 60) / 30) * 30, 30), 12 * 60);
}

/** End time for a single-day booking, never wrapping past midnight. */
export function endTimeFor(start: string, minutes: number): { end: string; clamped: boolean } {
  const total = toMinutes(start) + Math.max(0, Math.round(minutes));
  return { end: fromMinutes(total), clamped: total > 23 * 60 + 59 };
}

/** Length for a job: estimated_duration wins, else the default. */
export function jobMinutes(job: { estimated_duration?: string | null; job_type?: string | null }, units = 1): number {
  return intervalToMinutes(job.estimated_duration) ?? defaultMinutes(job.job_type, units);
}

/** Length for a lead booking: estimated_duration_minutes wins; sales lane = sales visit. */
export function leadMinutes(lead: { estimated_duration_minutes?: number | null; primary_intent?: string | null; service_type?: string | null }): number {
  if (lead.estimated_duration_minutes && lead.estimated_duration_minutes > 0) return lead.estimated_duration_minutes;
  return defaultMinutes(lead.primary_intent === "sales" ? "sales" : lead.service_type || "sales");
}

/** SAST wall-clock parts of an ISO timestamp. */
export function sastParts(iso: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const h = g("hour") === "24" ? "00" : g("hour");
  return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${h}:${g("minute")}` };
}
