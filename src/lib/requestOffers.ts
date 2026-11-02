/** B/C helpers. SQL mirrors: fl_offer_waves_due, fl_rough_area (migration 20261102190000). */
export type RequestAlertSettings = { contact_limit_wmin: number; unscheduled_limit_wmin: number; task_overdue_wdays: number; enabled: boolean };
export const DEFAULT_REQUEST_ALERTS: RequestAlertSettings = { contact_limit_wmin: 120, unscheduled_limit_wmin: 1440, task_overdue_wdays: 1, enabled: true };
export type LeadOfferSettings = { first_wave: number; first_window_min: number; widen_every_min: number; widen_by: number; escalate_after_min: number; enabled: boolean };
export const DEFAULT_LEAD_OFFERS: LeadOfferSettings = { first_wave: 3, first_window_min: 5, widen_every_min: 2, widen_by: 2, escalate_after_min: 10, enabled: false };
export const OFFER_LIMITS: Record<Exclude<keyof LeadOfferSettings, "enabled">, [number, number]> = {
  first_wave: [3, 5], first_window_min: [1, 60], widen_every_min: [1, 30], widen_by: [1, 10], escalate_after_min: [2, 120],
};
export const clampInt = (v: unknown, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, Math.round(Number(v) || lo)));

/** Waves due after `elapsedMin`: 1 at start, 2 at first_window, then +1 every widen_every. */
export const wavesDue = (elapsedMin: number, s: Pick<LeadOfferSettings, "first_window_min" | "widen_every_min">) =>
  elapsedMin < s.first_window_min ? 1 : 2 + Math.floor((elapsedMin - s.first_window_min) / s.widen_every_min);

/** Reps offered after `elapsedMin` (capped by team size). */
export const repsOffered = (elapsedMin: number, s: LeadOfferSettings, teamSize: number) =>
  Math.min(teamSize, s.first_wave + (wavesDue(elapsedMin, s) - 1) * s.widen_by);

/** Rough area for a pre-accept offer: no house numbers or street part. */
export const roughArea = (area?: string | null) =>
  ((area || "").split("—")[0].replace(/^.*\//, "").replace(/[0-9]+/g, "").trim()) || null;

export type RankRep = { id: string; available: boolean; km: number | null; skill: boolean; load: number };
/** Johan 18:47: availability, then distance, then skills, then workload. */
export const rankReps = (reps: RankRep[]) => [...reps].sort((a, b) =>
  Number(b.available) - Number(a.available) || (a.km ?? 1e9) - (b.km ?? 1e9) || Number(b.skill) - Number(a.skill) || a.load - b.load || a.id.localeCompare(b.id));

export type RepOffer = { offer_id: string; request_id: string; job_type: string; area: string; offered_at: string; state: "open" | "accepted" | "taken" | "passed"; customer_name: string | null; phone: string | null; address: string | null };
export const PRE_ACCEPT_KEYS = ["offer_id", "request_id", "job_type", "area", "offered_at", "state"] as const;

export const ALERT_KIND_LABEL: Record<string, string> = {
  not_contacted: "Not contacted", service_unscheduled: "Service has no date", move_unscheduled: "Move has no date", task_overdue: "Task overdue",
};
