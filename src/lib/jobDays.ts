/**
 * Phase (b): multi-day jobs with a daily check-in. Types, RPC wrappers and the pure rules the screens share.
 * Full day = the tech's working hours (company hours, 9 h by default); whole days only; weekends, SA public holidays,
 * company closure days and leave are skipped server-side (_job_days_plan). Day hours are non-billable.
 */
import { supabase } from "@/integrations/supabase/client";

export type DayClash = { start: string; end: string; label: string; job_id: string | null; lead_id: string | null };
export type PlanDay = { day_index: number; date: string; start: string; end: string; minutes: number; worked?: boolean; schedule_id?: string | null; clashes?: DayClash[] };
export type DaysPlan = {
  days: PlanDay[]; day_count: number; skipped: { date: string; reason: string }[]; clash_days: number; total_minutes: number;
  first: string | null; last: string | null; ok?: boolean; message?: string; dry_run?: boolean; job_id?: string;
};
export type DayState = "done" | "on_site" | "en_route" | "not_needed" | "missed" | "today" | "upcoming";
export type JobDay = {
  schedule_id: string; day_index: number; day_count: number; date: string; start: string | null; end: string | null; agent_id: string | null;
  en_route_at: string | null; checked_in_at: string | null; checked_out_at: string | null;
  hours: number | null; hours_auto: number | null; hours_edit_note: string | null; notes: string | null; state: DayState;
};
export type JobDays = { job_id: string; status: string; today: string; multi_day: boolean; day_count: number; scheduled_until: string | null; days: JobDay[]; labour_hours: number };
export type BoardDayState = { schedule_id: string; job_id: string; date: string; state: "done" | "on_site" | "en_route" | "none"; hours: number | null };

/** Biggest run the pickers offer (the server allows 30). */
export const MAX_PICK_DAYS = 10;
/** A changed hours figure needs a note when it differs from the check-in time by this much or more. */
export const HOURS_NOTE_THRESHOLD = 0.25;

const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args) as Promise<{ data: any; error: { message: string } | null }>;
async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const previewJobDays = (techId: string | null, startDate: string, days: number, jobId?: string | null) =>
  call<DaysPlan>("preview_job_days", { p_tech_id: techId, p_start_date: startDate, p_days: days, p_job_id: jobId ?? null });
export const scheduleJobDays = (a: { jobId: string; techId: string; startDate: string; days?: number | null; force?: boolean; reason?: string | null; dryRun?: boolean }) =>
  call<DaysPlan>("schedule_job_days", { p_job_id: a.jobId, p_tech_id: a.techId, p_start_date: a.startDate, p_days: a.days ?? null, p_dry_run: !!a.dryRun, p_force: !!a.force, p_reason: a.reason ?? null });
export const loadJobDays = (jobId: string) => call<JobDays>("job_days", { p_job_id: jobId });
export const loadDayStates = (from: string, to: string) => call<BoardDayState[]>("job_day_states", { p_from: from, p_to: to });
export const addJobDay = (jobId: string, force = false, reason: string | null = null) =>
  call<{ ok: boolean; date?: string; day_index?: number; day_count?: number; needs_office?: boolean; clash?: boolean; clashes?: DayClash[]; message?: string }>(
    "job_add_day", { p_job_id: jobId, p_force: force, p_reason: reason });

/** The three tech taps that also work offline (queued with the tap time). */
export type DayOp = "tech_day_en_route" | "tech_check_in" | "tech_done_for_today";
export type DayOpArgs = { p_job_id: string; p_at: string; p_hours?: number | null; p_notes?: string | null; p_edit_note?: string | null };
export const runDayOp = (fn: DayOp, args: DayOpArgs) => call<Record<string, any>>(fn, args as unknown as Record<string, unknown>);

// ── pure helpers ────────────────────────────────────────────────────────────────────────────────

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Thu 22 Oct" from 'YYYY-MM-DD' (calendar day, no time zone shift). */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DOW[dt.getUTCDay()]} ${d} ${MON[m - 1]}`;
}
export const hoursText = (h: number | null | undefined) => (h == null ? "–" : `${Math.round(h * 10) / 10} h`);

/** "3 days · Thu 22 Oct – Mon 26 Oct · 27 h" */
export function planSummary(p: Pick<DaysPlan, "day_count" | "first" | "last" | "total_minutes">): string {
  if (!p.day_count || !p.first) return "No working days found";
  const range = p.first === p.last || !p.last ? dayLabel(p.first) : `${dayLabel(p.first)} – ${dayLabel(p.last)}`;
  return `${p.day_count} day${p.day_count === 1 ? "" : "s"} · ${range} · ${hoursText(p.total_minutes / 60)}`;
}

/** "Sat 24 Oct · Weekend" / "Thu 24 Sep · Heritage Day" / "Mon 28 Dec · Year-end shutdown (company closed)". */
export const skipText = (s: { date: string; reason: string }) => `${dayLabel(s.date)} · ${s.reason}`;

/** The big button on the tech's job screen for today's day of a run. */
export type DayAction =
  | { kind: "en_route" | "check_in"; label: string; sub: string }
  | { kind: "done_for_today" | "job_complete"; label: string; sub: string }
  | { kind: "day_done"; label: string; sub: string }
  | { kind: "none"; label: string; sub: string };
export function dayAction(d: JobDays | null | undefined, today = d?.today ?? ""): DayAction {
  if (!d || !d.multi_day) return { kind: "none", label: "", sub: "" };
  if (["completed", "cancelled"].includes(d.status)) return { kind: "none", label: "Job closed", sub: "" };
  const day = d.days.find((x) => x.date === today);
  if (!day) {
    const next = d.days.find((x) => x.date > today);
    return { kind: "none", label: next ? `Next: Day ${next.day_index} of ${next.day_count}` : "No day booked today", sub: next ? dayLabel(next.date) : "Ask the office to add a day" };
  }
  const tag = `Day ${day.day_index} of ${day.day_count}`;
  const last = day.day_index >= day.day_count;
  if (day.checked_out_at) {
    if (last) return { kind: "job_complete", label: "Job complete", sub: `${tag} · Day done · after-photos and sign-off` };
    const next = d.days.find((x) => x.date > today);
    return { kind: "day_done", label: "Day done", sub: next ? `${tag} · back ${dayLabel(next.date)}` : tag };
  }
  if (day.checked_in_at) return last
    ? { kind: "job_complete", label: "Job complete", sub: `${tag} · last day` }
    : { kind: "done_for_today", label: "Done for today", sub: tag };
  return { kind: "check_in", label: `${tag} · Check in`, sub: day.en_route_at ? "You're en route" : `${day.start ?? ""}–${day.end ?? ""}` };
}

/** Hours since check-in, rounded to 0.25 h, for the Done-for-today prefill. */
export function autoHours(checkedInAt: string | null | undefined, now = new Date()): number {
  if (!checkedInAt) return 0;
  const h = (now.getTime() - new Date(checkedInAt).getTime()) / 3_600_000;
  return Math.max(0, Math.min(16, Math.round(h * 4) / 4));
}
export const hoursNeedNote = (hours: number, auto: number) => Math.abs(hours - auto) >= HOURS_NOTE_THRESHOLD;
/** Validation for the Done-for-today sheet; null = OK. */
export function doneForTodayError(hours: number, auto: number, editNote: string): string | null {
  if (!Number.isFinite(hours) || hours < 0 || hours > 16) return "Hours must be between 0 and 16";
  if (hoursNeedNote(hours, auto) && editNote.trim().length < 3) return `Say why the hours differ from the check-in time (${hoursText(auto)})`;
  return null;
}

/** Short badge on calendar tiles / cards: "Day 2/3". */
export const dayBadge = (index?: number | null, count?: number | null) => (count && count > 1 && index ? `Day ${index}/${count}` : null);
export const DAY_STATE_TEXT: Record<string, string> = { done: "Day done", on_site: "On site", en_route: "En route", missed: "Missed", not_needed: "Not needed", today: "Today", upcoming: "Upcoming" };

/** Labour on a run = the sum of the day entries (hours). */
export const sumDayHours = (days: Pick<JobDay, "hours">[]) => Math.round(days.reduce((s, d) => s + Number(d.hours || 0), 0) * 100) / 100;

/** Days of a dragged run: the drop date becomes the first not-yet-worked day; the rest follow on working days. */
export function remainingDays(days: Pick<JobDay, "checked_in_at">[]): number {
  return days.filter((d) => !d.checked_in_at).length;
}
