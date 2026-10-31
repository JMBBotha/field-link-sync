/**
 * Job visits (Johan 31 Oct): a job over one or more days, each with its own date, start and end.
 * Stored as job_schedules rows (same rows the dispatch board, calendar and tech Today list read per day).
 * Server: set_job_visits / job_visits. These pure rules are shared by the sheet, the job page and tests.
 */
export type JobVisit = { id?: string | null; date: string; start: string; end: string; tech?: string | null; tech_name?: string | null; note?: string | null; worked?: boolean };

const toMin = (t: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t ?? ""); return m ? +m[1] * 60 + +m[2] : NaN; };
export const visitMinutes = (v: Pick<JobVisit, "start" | "end">) => { const s = toMin(v.start), e = toMin(v.end); return Number.isFinite(s) && Number.isFinite(e) && e > s ? e - s : 0; };
export const totalVisitMinutes = (vs: JobVisit[]) => vs.reduce((a, v) => a + visitMinutes(v), 0);
export const sortVisits = <T extends JobVisit>(vs: T[]) => [...vs].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
export function hoursLabel(min: number) { const h = Math.floor(min / 60), m = min % 60; return m ? `${h}h ${String(m).padStart(2, "0")}m` : `${h}h`; }

/** First problem with the visit list, or null. Mirrors set_job_visits checks. */
export function visitsError(vs: JobVisit[]): string | null {
  if (!vs.length) return "Add at least one visit";
  if (vs.length > 130) return "At most 130 visits";
  const seen = new Set<string>();
  for (const [i, v] of vs.entries()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date ?? "")) return `Visit ${i + 1} needs a date`;
    if (!Number.isFinite(toMin(v.start)) || !Number.isFinite(toMin(v.end))) return `Visit ${i + 1} needs a start and end time`;
    if (toMin(v.end) <= toMin(v.start)) return `Visit ${i + 1} ends before it starts`;
    if (seen.has(v.date)) return "Two visits on the same day — combine them or pick another date";
    seen.add(v.date);
  }
  return null;
}
const key = (v: JobVisit) => [v.id ?? "", v.date, v.start, v.end, v.tech ?? "", (v.note ?? "").trim()].join("|");
export const visitsChanged = (a: JobVisit[], b: JobVisit[]) => sortVisits(a).map(key).join("~") !== sortVisits(b).map(key).join("~");
/** Next visit suggestion: the day after the last one, same hours. */
export function nextVisit(vs: JobVisit[], today: string): JobVisit {
  const last = sortVisits(vs).at(-1);
  if (!last) return { date: today, start: "08:00", end: "11:00" };
  const d = new Date(`${last.date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1);
  return { date: d.toISOString().slice(0, 10), start: last.start, end: last.end, tech: last.tech ?? null };
}
export function visitDayLabel(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
