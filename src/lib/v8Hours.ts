/** Per-person working window for a date: person's staff_work_hours row → company work days/hours → Mon–Fri 08:00–17:00.
 *  Same order as the staff_work_window RPC (leave is not included here). */
export type HoursRow = { profile_id: string; day_of_week: number; start_time: string | null; end_time: string | null; is_working: boolean };
export type CompanyHours = { work_days: number[] | null; work_start: string | null; work_end: string | null } | null;
export type Win = { working: boolean; start: number; end: number };
const m = (t: string | null | undefined, d: string) => { const [h, mm] = String(t || d).split(":").map(Number); return h * 60 + (mm || 0); };
export function v8WindowFor(profileId: string, date: string, rows: HoursRow[], company: CompanyHours): Win {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  const r = rows.find((x) => x.profile_id === profileId && x.day_of_week === dow);
  if (r) return { working: r.is_working, start: m(r.start_time, "08:00"), end: m(r.end_time, "17:00") };
  if (company?.work_days) return { working: company.work_days.includes(dow), start: m(company.work_start, "08:00"), end: m(company.work_end, "17:00") };
  return { working: dow >= 1 && dow <= 5, start: 8 * 60, end: 17 * 60 };
}
export const v8WinMinutes = (w: Win) => (w.working ? Math.max(0, w.end - w.start) : 0);
/** Outside the person's window (or on a day off) → shown as After hours (sales) / Overtime (techs). */
export function v8OutsideHours(w: Win, start: string, end: string): boolean {
  if (!w.working) return true;
  return m(start, "00:00") < w.start || m(end, "00:00") > w.end;
}
/** Fill tone: blue < 85%, orange 85–100%, red over 100% (overtime booked). */
export const v8FillTone = (pct: number) => (pct > 100 ? "over" : pct >= 85 ? "hot" : "");
