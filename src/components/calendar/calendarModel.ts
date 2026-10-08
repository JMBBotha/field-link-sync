import { hhmm, toMinutes, fromMinutes } from "@/lib/schedulingDefaults";
import { chipLane, type CardJob } from "@/lib/cardModel";
import { laneOf } from "@/lib/leadLane";

export type CalendarLead = {
  id: string; customer_name: string; customer_address: string; service_type: string;
  status: string; priority: string; assigned_agent_id: string | null;
  scheduled_date: string | null; scheduled_time: string | null;
  estimated_duration_minutes?: number | null; primary_intent?: string | null;
};
export type CalendarSchedule = {
  id: string; lead_id: string; job_id?: string | null; agent_id: string | null;
  scheduled_date: string; start_time: string; end_time: string; notes: string | null;
  leads?: Pick<CalendarLead, "customer_name" | "customer_address" | "service_type" | "status" | "priority"> | null;
  jobs?: { status?: string | null } | null;
  clash?: { start: string; end: string; label: string } | null;
};
export type CalendarPerson = { id: string; full_name: string; availability_status: string | null };
export const hoursLabel = (minutes: number) => `${Number((minutes / 60).toFixed(2))} h`;
export const bookingMinutes = (s: Pick<CalendarSchedule, "start_time" | "end_time">) => Math.max(0, toMinutes(s.end_time) - toMinutes(s.start_time));
export const bookingRange = (s: Pick<CalendarSchedule, "start_time" | "end_time">) => `${hhmm(s.start_time)}–${hhmm(s.end_time)}`;
export const calendarText = (text?: string | null, fallback = "Booking") => {
  const clean = (text || "").replace(/R\s?\d[\d\s,.]*/g, "").trim();
  return clean && clean !== "undefined" ? clean : fallback;
};
export function salesCalendarPeople<T extends { id: string }>(people: T[], sales: boolean, userId: string | null): T[] {
  return sales ? people.filter(p => p.id === userId) : people;
}
export type WorkWindow = { is_working: boolean; start_time: string; end_time: string; source: string };
export type BlockedTime = { id: string; profile_id: string; starts_at: string; ends_at: string; kind: "leave" | "blocked" | string; reason: string | null };
type Span = { start_time: string; end_time: string };
/** Person row → company days/hours → Mon–Fri 08:00–17:00 (mirrors SQL staff_work_window). */
export function resolveWorkWindow(dow: number, person?: { is_working: boolean; start_time: string | null; end_time: string | null } | null,
  company?: { work_days: number[] | null; work_start: string | null; work_end: string | null } | null): WorkWindow {
  if (person) return { is_working: person.is_working, start_time: hhmm(person.start_time || "08:00"), end_time: hhmm(person.end_time || "17:00"), source: "person" };
  if (company?.work_days) return { is_working: company.work_days.includes(dow), start_time: hhmm(company.work_start || "08:00"), end_time: hhmm(company.work_end || "17:00"), source: "company" };
  return { is_working: dow >= 1 && dow <= 5, start_time: "08:00", end_time: "17:00", source: "default" };
}
/** Sum of booked minutes with overlaps counted once. */
export function mergedMinutes(spans: Span[]) {
  const iv = spans.map(s => [toMinutes(s.start_time), toMinutes(s.end_time)]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let total = 0, cs = -1, ce = -1;
  for (const [a, b] of iv) { if (a > ce) { if (ce > cs) total += ce - cs; cs = a; ce = b; } else ce = Math.max(ce, b); }
  return total + (ce > cs ? ce - cs : 0);
}
/** Clip a blocked row to one SAST day as HH:MM span. */
export function blockedSpan(b: Pick<BlockedTime, "starts_at" | "ends_at">, date: string): Span | null {
  const dayStart = new Date(`${date}T00:00:00+02:00`).getTime(), dayEnd = dayStart + 86400000;
  const a = Math.max(dayStart, new Date(b.starts_at).getTime()), e = Math.min(dayEnd, new Date(b.ends_at).getTime());
  if (e <= a) return null;
  return { start_time: fromMinutes(Math.round((a - dayStart) / 60000)), end_time: fromMinutes(Math.min(1439, Math.round((e - dayStart) / 60000))) };
}
export function freeGaps(bookings: Span[], window: { start_time: string; end_time: string; is_working?: boolean } = { start_time: "08:00", end_time: "17:00" }, blocked: Span[] = []) {
  if (window.is_working === false) return [];
  const begin = toMinutes(window.start_time), end = toMinutes(window.end_time);
  let cursor = begin;
  const gaps: { start: string; end: string; minutes: number }[] = [];
  const intervals = [...bookings, ...blocked].map(s => ({ start: toMinutes(s.start_time), end: toMinutes(s.end_time) }))
    .filter(s => s.end > cursor && s.start < end && s.end > s.start).sort((a, b) => a.start - b.start);
  for (const s of intervals) {
    const start = Math.max(begin, s.start);
    if (start > cursor) gaps.push({ start: fromMinutes(cursor), end: fromMinutes(start), minutes: start - cursor });
    cursor = Math.max(cursor, s.end);
  }
  if (cursor < end) gaps.push({ start: fromMinutes(cursor), end: fromMinutes(end), minutes: end - cursor });
  return gaps;
}
export function loadTone(minutes: number, clash: boolean, capacity = 540) {
  return clash || minutes > capacity ? "destructive" : minutes > capacity * 0.75 ? "warning" : "primary";
}

/** Preserve the calendar booking's own date/time and job identity. */
export function calendarScheduleToCard(schedule: CalendarSchedule, lead?: CalendarLead): CardJob {
  const details = schedule.leads || lead;
  const title = calendarText(details?.customer_name, calendarText(details?.service_type));
  return {
    id: schedule.job_id || schedule.lead_id || schedule.id, kind: schedule.job_id ? "job" : "visit",
    title, scheduledFor: `${schedule.scheduled_date}T${hhmm(schedule.start_time)}:00+02:00`,
    statusKey: schedule.jobs?.status || details?.status || "scheduled",
    priority: details?.priority, place: calendarText(details?.customer_address, "Address pending"),
    clientName: title, lane: chipLane(schedule.job_id ? "service" : laneOf(lead || details || {}) || "sales", details?.service_type),
    urgency: { key: "later", rank: 6, mins: null },
  };
}