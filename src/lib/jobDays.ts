/**
 * Phase (b): multi-day jobs with a daily check-in. Types, RPC wrappers and the pure rules the screens share.
 * Full day = the tech's working hours (company hours, 9 h by default); whole days only; weekends, SA public holidays,
 * company closure days and leave are skipped server-side (_job_days_plan). Day hours are non-billable.
 */
import { supabase } from "@/integrations/supabase/client";

export type DayClash = { start: string; end: string; label: string; job_id: string | null; lead_id: string | null };
export type PlanDay = { day_index: number; date: string; start: string; end: string; minutes: number; worked?: boolean; schedule_id?: string | null; clashes?: DayClash[] };
/** Server clash summary for long runs (0030): first clash dates + bookings grouped by label with day counts. */
export type ClashSummary = {
  days: number; first: string; last: string; dates: string[]; more_dates: number;
  by_label: { label: string; days: number; first: string; last: string }[]; more_labels: number;
};
export type DaysPlan = {
  days: PlanDay[]; day_count: number; skipped: { date: string; reason: string }[]; clash_days: number; total_minutes: number;
  first: string | null; last: string | null; ok?: boolean; message?: string; dry_run?: boolean; job_id?: string;
  /** 0030 long runs: last working day, the cap, clash summary and a warning when holidays are not loaded that far ahead. */
  expected_end?: string | null; max_days?: number; clash_summary?: ClashSummary | null;
  holidays_known_until?: string | null; holidays_unknown?: boolean;
};
export type DayState = "done" | "on_site" | "en_route" | "not_needed" | "missed" | "today" | "upcoming";
export type JobDay = {
  schedule_id: string; day_index: number; day_count: number; date: string; start: string | null; end: string | null; agent_id: string | null;
  en_route_at: string | null; checked_in_at: string | null; checked_out_at: string | null;
  hours: number | null; hours_auto: number | null; hours_edit_note: string | null; notes: string | null; state: DayState;
  /** Johan 23 Oct: each day is signed off by the tech (name + time) with >= 1 after photo. */
  signed_off_at?: string | null; signed_off_name?: string | null; after_photos?: number | null;
};
export type JobDays = { job_id: string; status: string; today: string; multi_day: boolean; day_count: number; scheduled_until: string | null; days: JobDay[]; labour_hours: number; lead_id?: string | null };
export type BoardDayState = { schedule_id: string; job_id: string; date: string; state: "done" | "on_site" | "en_route" | "none"; hours: number | null };

/** Biggest run (working days, ~6 months). Same cap as the server (job_schedules_day_chk / _job_days_plan, 0030). */
export const MAX_PICK_DAYS = 130;
/** A changed hours figure needs a note when it differs from the check-in time by this much or more. */
export const HOURS_NOTE_THRESHOLD = 0.25;

const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args) as Promise<{ data: any; error: { message: string } | null }>;
async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Plan by number of working days, or (days = null) every working day up to and including endDate. */
export const previewJobDays = (techId: string | null, startDate: string, days: number | null, jobId?: string | null, endDate?: string | null) =>
  call<DaysPlan>("preview_job_days", { p_tech_id: techId, p_start_date: startDate, p_days: days, p_end_date: days == null ? endDate ?? null : null, p_job_id: jobId ?? null });
export const scheduleJobDays = (a: { jobId: string; techId: string; startDate: string; days?: number | null; endDate?: string | null; force?: boolean; reason?: string | null; dryRun?: boolean }) =>
  call<DaysPlan>("schedule_job_days", { p_job_id: a.jobId, p_tech_id: a.techId, p_start_date: a.startDate, p_days: a.days ?? null, ...(a.endDate && a.days == null ? { p_end_date: a.endDate } : {}), p_dry_run: !!a.dryRun, p_force: !!a.force, p_reason: a.reason ?? null });
export const loadJobDays = (jobId: string) => call<JobDays>("job_days", { p_job_id: jobId });
export const loadDayStates = (from: string, to: string) => call<BoardDayState[]>("job_day_states", { p_from: from, p_to: to });
export const addJobDay = (jobId: string, force = false, reason: string | null = null) =>
  call<{ ok: boolean; date?: string; day_index?: number; day_count?: number; needs_office?: boolean; clash?: boolean; clashes?: DayClash[]; message?: string }>(
    "job_add_day", { p_job_id: jobId, p_force: force, p_reason: reason });

/** The three tech taps that also work offline (queued with the tap time). */
export type DayOp = "tech_day_en_route" | "tech_check_in" | "tech_done_for_today";
export type DayOpArgs = {
  p_job_id: string; p_at: string; p_hours?: number | null; p_notes?: string | null; p_edit_note?: string | null;
  /** Done for today: the tech's sign-off (required) and an optional drawn signature / client signature. */
  p_signoff_name?: string | null; p_tech_signature?: string | null; p_client_name?: string | null; p_client_signature?: string | null;
};
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

/** "Mon 2 Nov 2026" — dayLabel plus the year (used when a run crosses a year end). */
export const dayLabelYear = (date: string) => `${dayLabel(date)} ${date.slice(0, 4)}`;
/** "Thu 22 Oct – Mon 26 Oct", or with years when the run crosses into the next year. */
export function rangeLabel(first: string, last?: string | null): string {
  if (!last || first === last) return dayLabel(first);
  return first.slice(0, 4) === last.slice(0, 4) ? `${dayLabel(first)} – ${dayLabel(last)}` : `${dayLabelYear(first)} – ${dayLabelYear(last)}`;
}

/** "3 days · Thu 22 Oct – Mon 26 Oct · 27 h" */
export function planSummary(p: Pick<DaysPlan, "day_count" | "first" | "last" | "total_minutes">): string {
  if (!p.day_count || !p.first) return "No working days found";
  const range = rangeLabel(p.first, p.last);
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
    if (last) return { kind: "job_complete", label: "Job complete", sub: `${tag} · Day done · after photos + your sign-off` };
    const next = d.days.find((x) => x.date > today);
    return { kind: "day_done", label: "Day done", sub: next ? `${tag} · back ${dayLabel(next.date)}` : tag };
  }
  if (day.checked_in_at) return last
    ? { kind: "job_complete", label: "Job complete", sub: `${tag} · last day · after photos + your sign-off` }
    : { kind: "done_for_today", label: "Done for today", sub: `${tag} · after photos + your sign-off` };
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

/** The last day's check-in while it is still open (multi-day "Job complete"): after photos must be from that day. */
export function lastOpenCheckIn(d: JobDays | null | undefined): string | null {
  const last = d?.days?.[d.days.length - 1];
  return last && last.checked_in_at && !last.checked_out_at ? last.checked_in_at : null;
}

// ── Long runs (weeks to months) ─────────────────────────────────────────────────────────────────

/** Quick picks. Days = working days; weeks/months = every working day from the start until the same calendar span ends. */
export type LengthPick = { kind: "days"; n: number } | { kind: "weeks" | "months"; n: number } | { kind: "until"; end: string };
export const QUICK_PICKS: { key: string; label: string; pick: LengthPick }[] = [
  { key: "d2", label: "2 days", pick: { kind: "days", n: 2 } },
  { key: "d3", label: "3 days", pick: { kind: "days", n: 3 } },
  { key: "d5", label: "5 days", pick: { kind: "days", n: 5 } },
  { key: "w1", label: "1 week", pick: { kind: "weeks", n: 1 } },
  { key: "w2", label: "2 weeks", pick: { kind: "weeks", n: 2 } },
  { key: "w3", label: "3 weeks", pick: { kind: "weeks", n: 3 } },
  { key: "m1", label: "1 month", pick: { kind: "months", n: 1 } },
  { key: "m2", label: "2 months", pick: { kind: "months", n: 2 } },
  { key: "m3", label: "3 months", pick: { kind: "months", n: 3 } },
];
const pad = (n: number) => String(n).padStart(2, "0");
const isoUTC = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
/** Calendar date (no time-zone shift) n days after 'YYYY-MM-DD'. */
export function addDaysISO(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return isoUTC(new Date(Date.UTC(y, m - 1, d + n)));
}
/** Last calendar day of a weeks/months pick: 1 week from Mon 2 Nov = Sun 8 Nov; 1 month from 2 Nov = 1 Dec; 1 month from 31 Jan = 28/29 Feb. */
export function pickEndDate(start: string, pick: LengthPick): string | null {
  if (pick.kind === "until") return pick.end;
  if (pick.kind === "days") return null;
  if (pick.kind === "weeks") return addDaysISO(start, pick.n * 7 - 1);
  const [y, m, d] = start.split("-").map(Number);
  const lastOfTarget = new Date(Date.UTC(y, m - 1 + pick.n + 1, 0)).getUTCDate();
  const same = new Date(Date.UTC(y, m - 1 + pick.n, Math.min(d, lastOfTarget)));
  return addDaysISO(isoUTC(same), d <= lastOfTarget ? -1 : 0);
}
/** Arguments for preview_job_days: a day count, or an end date (the server counts the working days). */
export function pickArgs(start: string, pick: LengthPick): { days: number | null; end: string | null } {
  return pick.kind === "days" ? { days: pick.n, end: null } : { days: null, end: pickEndDate(start, pick) };
}
/** "3 weeks" / "Until Fri 29 Jan" / "12 days" for the picker heading. */
export function pickLabel(pick: LengthPick): string {
  if (pick.kind === "until") return `Until ${dayLabel(pick.end)}`;
  if (pick.kind === "days") return `${pick.n} working day${pick.n === 1 ? "" : "s"}`;
  return `${pick.n} ${pick.kind === "weeks" ? "week" : "month"}${pick.n === 1 ? "" : "s"}`;
}

/** Clash summary from the server, or built from the per-day list (older server / dry runs). */
export function clashSummaryOf(plan: Pick<DaysPlan, "days" | "clash_days" | "clash_summary">): ClashSummary | null {
  if (plan.clash_summary) return plan.clash_summary;
  const hit = plan.days.filter((d) => (d.clashes?.length ?? 0) > 0);
  if (!hit.length) return null;
  const g = new Map<string, { label: string; days: number; first: string; last: string }>();
  for (const d of hit) for (const label of new Set(d.clashes!.map((c) => c.label))) {
    const x = g.get(label);
    if (!x) g.set(label, { label, days: 1, first: d.date, last: d.date }); else { x.days++; x.last = d.date; }
  }
  const by = [...g.values()].sort((a, b) => b.days - a.days || a.first.localeCompare(b.first));
  return { days: hit.length, first: hit[0].date, last: hit[hit.length - 1].date, dates: hit.slice(0, 12).map((d) => d.date), more_dates: Math.max(0, hit.length - 12),
    by_label: by.slice(0, 6), more_labels: Math.max(0, by.length - 6) };
}
/** "Busy on 9 of 65 days (Tue 10 Nov – Tue 2 Feb 2027)" */
export function clashHeadline(s: ClashSummary, dayCount: number): string {
  return `Busy on ${s.days} of the ${dayCount} days (${s.days === 1 ? dayLabel(s.first) : rangeLabel(s.first, s.last)})`;
}
/** "TEST Clash Client · 9 days" lines (label groups). */
export const clashGroupText = (g: ClashSummary["by_label"][number]) =>
  `${g.label} · ${g.days === 1 ? dayLabel(g.first) : `${g.days} days, ${rangeLabel(g.first, g.last)}`}`;

/** Progress of a run for the tech and office screens: Day N of M, % done, expected end. */
export type RunProgress = {
  total: number; done: number; pct: number; current: number | null; currentIsToday: boolean;
  first: string | null; expectedEnd: string | null; remaining: number; missed: number; headline: string; sub: string;
};
export function runProgress(d: Pick<JobDays, "days" | "day_count" | "status" | "today">, today = d.today): RunProgress {
  const days = d.days;
  const total = Math.max(d.day_count || 0, days.length);
  const done = days.filter((x) => !!x.checked_out_at || x.state === "done").length;
  const missed = days.filter((x) => x.state === "missed").length;
  const closed = ["completed", "cancelled"].includes(d.status);
  const pct = closed && d.status === "completed" ? 100 : total ? Math.round((done / total) * 100) : 0;
  const first = days[0]?.date ?? null;
  const expectedEnd = days[days.length - 1]?.date ?? null;
  const todayDay = days.find((x) => x.date === today);
  const next = days.find((x) => x.date > today);
  const current = todayDay?.day_index ?? next?.day_index ?? null;
  const remaining = days.filter((x) => !x.checked_out_at && x.state !== "done" && x.state !== "not_needed" && x.date >= today).length;
  let headline: string; let sub: string;
  if (closed) { headline = d.status === "completed" ? `Finished · ${total} days` : "Cancelled"; sub = expectedEnd ? `Last day ${dayLabel(expectedEnd)}` : ""; }
  else if (todayDay) { headline = `Day ${todayDay.day_index} of ${total}`; sub = `ends ${expectedEnd ? dayLabel(expectedEnd) : "–"}`; }
  else if (first && today < first) { headline = `Starts ${dayLabel(first)}`; sub = `ends ${expectedEnd ? dayLabel(expectedEnd) : "–"}`; }
  else if (next) { headline = `Next: Day ${next.day_index} of ${total}`; sub = `${dayLabel(next.date)} · ends ${expectedEnd ? dayLabel(expectedEnd) : "–"}`; }
  else { headline = `All ${total} days booked are past`; sub = `last day ${expectedEnd ? dayLabel(expectedEnd) : "–"}`; }
  return { total, done, pct, current, currentIsToday: !!todayDay, first, expectedEnd, remaining, missed, headline, sub };
}

/** Which rows a long day list shows by default: the last 2 days before today, today and the next 4 (the rest fold away). */
export const LONG_RUN_FOLD = 8;
export function visibleDayWindow<T extends { date: string }>(days: T[], today: string, before = 2, after = 4): { from: number; to: number } {
  if (days.length <= LONG_RUN_FOLD) return { from: 0, to: days.length };
  let i = days.findIndex((x) => x.date >= today);
  if (i < 0) i = days.length - 1;
  const from = Math.max(0, Math.min(i - before, days.length - (before + after + 1)));
  return { from, to: Math.min(days.length, from + before + after + 1) };
}
/** Board tile tooltip: "Day 23 of 44 · ends Wed 3 Feb". */
export const dayBadgeTitle = (index?: number | null, count?: number | null, end?: string | null) =>
  count && count > 1 && index ? `Day ${index} of ${count}${end ? ` · ends ${dayLabel(end)}` : ""}` : undefined;
