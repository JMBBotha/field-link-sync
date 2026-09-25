/**
 * Spoken date → YYYY-MM-DD in Africa/Johannesburg (UTC+2, no DST).
 * Accepts "today", "tomorrow", "yesterday", weekday names ("Friday",
 * "next Friday"), "3 October", "October 3", "3/10", ISO "2026-10-03".
 * Weekday = the next occurrence (today counts only if said "today").
 */
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const pad = (n: number) => String(n).padStart(2, "0");
const fmt = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

/** Today's calendar date in Johannesburg, as UTC-midnight Date (for safe arithmetic). */
export function sastToday(now: Date = new Date()): Date {
  const s = new Date(now.getTime() + SAST_OFFSET_MS);
  return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()));
}

const iso = (d: Date) => fmt(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

export function resolveSpokenDate(input: string, now: Date = new Date()): string | null {
  const t = (input || "").toLowerCase().replace(/[,.]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const today = sastToday(now);
  if (/\btoday\b|\btonight\b|\bnow\b/.test(t)) return iso(today);
  if (/\bday after tomorrow\b/.test(t)) return iso(addDays(today, 2));
  if (/\btomorrow\b/.test(t)) return iso(addDays(today, 1));
  if (/\byesterday\b/.test(t)) return iso(addDays(today, -1));

  const isoM = t.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoM) return fmt(+isoM[1], +isoM[2] - 1, +isoM[3]);

  const wd = WEEKDAYS.findIndex((w) => new RegExp(`\\b${w}\\b|\\b${w.slice(0, 3)}\\b`).test(t));
  if (wd >= 0) {
    let diff = (wd - today.getUTCDay() + 7) % 7;
    if (diff === 0) diff = 7;
    if (/\bnext\b/.test(t) && diff < 7 && /\bnext week\b/.test(t)) diff += 7;
    return iso(addDays(today, diff));
  }

  const mi = MONTHS.findIndex((m) => new RegExp(`\\b${m}\\b|\\b${m.slice(0, 3)}\\b`).test(t));
  if (mi >= 0) {
    const dm = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/);
    if (!dm) return null;
    const day = +dm[1];
    let y = today.getUTCFullYear();
    // A date already past this year means next year.
    if (Date.UTC(y, mi, day) < today.getTime()) y += 1;
    return fmt(y, mi, day);
  }

  const dmy = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/); // SA: day/month
  if (dmy) {
    let y = dmy[3] ? +dmy[3] : today.getUTCFullYear();
    if (y < 100) y += 2000;
    return fmt(y, +dmy[2] - 1, +dmy[1]);
  }
  return null;
}
