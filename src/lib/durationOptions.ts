/** Shared duration chips / stepper logic (Johan 23 Oct 2026). Pure, unit-tested. */
import { fromMinutes, toMinutes, MAX_SINGLE_DAY_MINUTES } from "@/lib/schedulingDefaults";

export const STEP_MINUTES = 30;
export const MIN_MINUTES = 30;

export type DurationChip = { key: string; label: string; minutes: number };

/** 1h / 2h / 4h / Full day (= company hours, e.g. 9h). */
export function durationChips(fullDayMinutes: number): DurationChip[] {
  return [
    { key: "1h", label: "1 h", minutes: 60 },
    { key: "2h", label: "2 h", minutes: 120 },
    { key: "4h", label: "4 h", minutes: 240 },
    { key: "full", label: `Full day (${formatDuration(fullDayMinutes)})`, minutes: fullDayMinutes },
  ];
}

/** 90 → "1 h 30", 180 → "3 h", 45 → "45 min". */
export function formatDuration(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, "0")}` : `${h} h`;
}

/** Longest single-day length from a start time (never past 23:59). */
export function maxMinutesFrom(start?: string | null): number {
  if (!start) return 12 * 60;
  return Math.max(MIN_MINUTES, Math.min(MAX_SINGLE_DAY_MINUTES, 23 * 60 + 59 - toMinutes(start)));
}

export function stepDuration(current: number, dir: 1 | -1, max = 12 * 60): number {
  const snapped = dir > 0 ? Math.floor(current / STEP_MINUTES) * STEP_MINUTES + STEP_MINUTES
                         : Math.ceil(current / STEP_MINUTES) * STEP_MINUTES - STEP_MINUTES;
  return Math.max(MIN_MINUTES, Math.min(max, snapped));
}

export type DurationWarning = { kind: "after_hours" | "before_hours" | "longer_than_day" | "clamped"; text: string };

/** Ends-at plus warnings against company hours. Single-day only; the end never wraps past midnight. */
export function describeDuration(opts: { start?: string | null; minutes: number; workStart: string; workEnd: string; fullDayMinutes: number }) {
  const { start, minutes, workStart, workEnd, fullDayMinutes } = opts;
  const warnings: DurationWarning[] = [];
  let end: string | null = null;
  if (start) {
    const total = toMinutes(start) + minutes;
    end = fromMinutes(total);
    if (total > 23 * 60 + 59) warnings.push({ kind: "clamped", text: `Can't run past midnight — ends at 23:59.` });
    if (toMinutes(start) < toMinutes(workStart)) warnings.push({ kind: "before_hours", text: `Starts before company hours (${workStart}).` });
    if (total > toMinutes(workEnd)) warnings.push({ kind: "after_hours", text: `Ends ${end}, after company hours (${workEnd}) — after-hours work.` });
  }
  if (minutes > fullDayMinutes && !warnings.some((w) => w.kind === "after_hours")) {
    warnings.push({ kind: "longer_than_day", text: `Longer than a working day (${formatDuration(fullDayMinutes)}) — runs after hours.` });
  }
  return { end, warnings };
}
