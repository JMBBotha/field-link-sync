import { hhmm, toMinutes, fromMinutes } from "@/lib/schedulingDefaults";
import type { CardJob } from "@/lib/cardModel";
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
export function freeGaps(bookings: Pick<CalendarSchedule, "start_time" | "end_time">[]) {
  const end = 17 * 60;
  let cursor = 8 * 60;
  const gaps: { start: string; end: string; minutes: number }[] = [];
  const intervals = bookings.map(s => ({ start: toMinutes(s.start_time), end: toMinutes(s.end_time) }))
    .filter(s => s.end > cursor && s.start < end && s.end > s.start).sort((a, b) => a.start - b.start);
  for (const s of intervals) {
    const start = Math.max(8 * 60, s.start);
    if (start > cursor) gaps.push({ start: fromMinutes(cursor), end: fromMinutes(start), minutes: start - cursor });
    cursor = Math.max(cursor, s.end);
  }
  if (cursor < end) gaps.push({ start: fromMinutes(cursor), end: fromMinutes(end), minutes: end - cursor });
  return gaps;
}
export function loadTone(minutes: number, clash: boolean) {
  return clash || minutes > 540 ? "destructive" : minutes > 540 * 0.75 ? "warning" : "primary";
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
    clientName: title, lane: schedule.job_id ? "service" : laneOf(lead || details || {}) || "sales",
    urgency: { key: "later", rank: 6, mins: null },
  };
}