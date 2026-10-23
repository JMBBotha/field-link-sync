/**
 * Job watch (phase a2): late alert, tech "En route", at-risk flag and office-approved "Tell client" drafts.
 * Mirrors the SQL in supabase/migrations/20261023200000_job_en_route_a2.sql (job_en_route_plan / drive_minutes_estimate).
 * Drive time comes from stored addresses only (previous job that day, else the tech's home base). No live location (POPIA).
 */
export type JobWatchSettings = {
  late_checkin_minutes: number;
  en_route_buffer_minutes: number;
  en_route_floor_minutes: number;
  en_route_fallback_minutes: number;
};

export const DEFAULT_JOB_WATCH: JobWatchSettings = {
  late_checkin_minutes: 30,
  en_route_buffer_minutes: 15,
  en_route_floor_minutes: 20,
  en_route_fallback_minutes: 60,
};

/** Same limits as the table CHECKs. */
export const JOB_WATCH_LIMITS: Record<keyof JobWatchSettings, [number, number]> = {
  late_checkin_minutes: [5, 240],
  en_route_buffer_minutes: [0, 120],
  en_route_floor_minutes: [0, 240],
  en_route_fallback_minutes: [5, 480],
};

export const clampWatch = (key: keyof JobWatchSettings, v: unknown) => {
  const [lo, hi] = JOB_WATCH_LIMITS[key];
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : DEFAULT_JOB_WATCH[key];
};

/** Straight line x 1.4 road factor at 45 km/h, minimum 5 min. null when either point is missing. */
export function driveMinutesEstimate(a?: { lat: number | null; lng: number | null } | null, b?: { lat: number | null; lng: number | null } | null): number | null {
  if (a?.lat == null || a?.lng == null || b?.lat == null || b?.lng == null) return null;
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  const km = 2 * 6371 * Math.asin(Math.sqrt(h));
  return Math.max(5, Math.ceil((km * 1.4) / 45 * 60));
}

/** Minutes before the booked start the tech must be en route: max(drive + buffer, floor); fallback when no drive estimate. */
export function enRouteLeadMinutes(driveMinutes: number | null, s: JobWatchSettings = DEFAULT_JOB_WATCH): number {
  if (driveMinutes == null) return s.en_route_fallback_minutes;
  return Math.max(driveMinutes + s.en_route_buffer_minutes, s.en_route_floor_minutes);
}

export const leaveBy = (start: string | Date, leadMinutes: number) => new Date(new Date(start).getTime() - leadMinutes * 60_000);

export type EnRoutePlan = {
  drive_minutes: number | null;
  drive_from: "previous job" | "home base" | "none";
  fallback: boolean;
  lead_minutes: number;
  leave_by: string;
};

export const hhmm = (d: string | Date) =>
  new Date(d).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Johannesburg" });

/** One-line explanation shown to the tech and the office. */
export function planText(p: EnRoutePlan | null | undefined): string | null {
  if (!p?.leave_by) return null;
  const why = p.fallback || p.drive_minutes == null
    ? `no drive estimate, ${p.lead_minutes}-min default`
    : `~${p.drive_minutes} min drive from ${p.drive_from}`;
  return `Leave by ${hhmm(p.leave_by)} (${why})`;
}

/** Office-facing labels for the watchdog rules. */
export const WATCH_RULE_LABEL: Record<string, string> = {
  not_accepted_urgent: "Not accepted – starts soon",
  not_accepted: "Not accepted",
  no_en_route: "At risk · not en route",
  not_started: "Late · not checked in",
  not_finished: "Running over",
};

/** Rules where the office may want to tell the client (draft only, approved by the office). */
export const TELL_CLIENT_RULES = new Set(["no_en_route", "not_started"]);

export type ClientChannel = "email" | "sms";

/** sms: link that opens the office phone's SMS app with the approved text (the app has no SMS provider). */
export function smsHref(phone: string, body: string): string {
  const to = phone.replace(/[^\d+]/g, "");
  return `sms:${to}?&body=${encodeURIComponent(body)}`;
}

export const looksLikeEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());
