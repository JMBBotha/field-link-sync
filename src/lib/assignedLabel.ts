import { friendlyWhen } from "@/lib/friendlyWhen";

/**
 * ONE "is this assigned?" rule for every card (requests, My jobs, Jobs board, booking/job detail).
 * Assignment/booking writes leads.assigned_agent_id (+ job_schedules) and, for jobs, an assignments row.
 * leads.status stays "pending" after booking, so status must never be used to decide "unassigned".
 */
export function isAssigned(x: { assigned_agent_id?: string | null; assigned_to?: string | null; tech_name?: string | null; assignee_id?: string | null }): boolean {
  return !!(x.assigned_agent_id || x.assigned_to || x.assignee_id || x.tech_name?.trim());
}

/** "Assigned to Innocent Mattienga · Tue 10 Nov, 08:00" (SAST). Null when nobody is assigned. */
export function assignedLabel(name?: string | null, date?: string | null, time?: string | null): string | null {
  const who = name?.trim();
  if (!who) return null;
  const when = friendlyWhen(date ?? null, time ?? null);
  return `Assigned to ${who}${when ? ` · ${when}` : ""}`;
}

/** Where a card opens for this person. Jobs -> job detail; booked lead with no job -> booking detail. */
export function cardHref(x: { job_id?: string | null; lead_id?: string | null }): string | null {
  if (x.job_id) return `/admin/jobs/${x.job_id}`;
  if (x.lead_id) return `/admin/bookings/${x.lead_id}`;
  return null;
}
