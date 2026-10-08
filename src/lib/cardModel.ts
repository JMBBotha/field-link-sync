import { format } from "date-fns";
import { activeAssignee, jobUrgency, type DJob, type Urgency } from "@/lib/dispatchCards";
import { boardLane, isCancelled, rowAssignee, type Person } from "@/lib/jobsBoard";
import type { CalendarEntry } from "@/lib/todaysJobs";

/** "Overdue · 9 Jan" for a card more than 24 h late; date-only values keep their calendar day. */
export function overdueLabel(scheduledFor: string | null): string {
  if (!scheduledFor) return "Overdue";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(scheduledFor) ? new Date(`${scheduledFor}T12:00:00`) : new Date(scheduledFor);
  return isNaN(d.getTime()) ? "Overdue" : `Overdue · ${format(d, "d MMM")}`;
}

/** Booked visits the user can't actually see: no job row AND the lead was hidden (empty customer name). */
export function visibleVisitEntries<T extends Pick<CalendarEntry, "job_id" | "customer_name">>(entries: T[]): T[] {
  return entries.filter((e) => e.job_id || String(e.customer_name || "").trim() !== "");
}

export type CardJob = {
  kind: "job" | "visit"; id: string; title: string; scheduledFor: string | null; statusKey: string;
  priority?: string | null; place?: string | null; clientName?: string | null;
  assigneeName?: string | null; assigneePhone?: string | null; clientPhone?: string | null;
  lane: "sales" | "service"; callSummary?: string | null; notes?: string | null;
  urgency: Urgency & { onSiteMins?: number | null };
};
type JobSource = DJob & {
  address?: string | null; customers?: { name?: string | null; phone?: string | null } | null;
  customer_locations?: { address?: string | null } | null;
  call_summary?: string | null; notes?: string | null; urgency?: Urgency;
};
const place = (address?: string | null) => (address || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 2).join(", ");
const statusKey = (status: string | null | undefined, assigned: boolean) => {
  const s = String(status || "").toLowerCase().trim();
  return !assigned && s !== "completed" && !isCancelled(s) ? "unassigned" : s;
};
export function jobToCard(job: JobSource): CardJob {
  const a = activeAssignee(job);
  const now = new Date();
  return {
    kind: "job", id: job.id, title: job.title || "Job", scheduledFor: job.scheduled_for || null,
    statusKey: statusKey(job.status, !!a), priority: job.priority,
    place: place(job.address || job.customer_locations?.address), clientName: job.customers?.name,
    assigneeName: a ? a.profiles?.full_name || "Assigned" : null, assigneePhone: a?.profiles?.phone,
    clientPhone: job.customers?.phone, lane: boardLane({ kind: "job", id: job.id, status: job.status || "", job }),
    callSummary: job.call_summary, notes: job.notes,
    urgency: { ...(job.urgency || jobUrgency(job, now)), onSiteMins: job.status === "in_progress" && job.started_at
      ? Math.max(0, Math.round((now.getTime() - new Date(job.started_at).getTime()) / 60000)) : null },
  };
}
export function visitToCard(entry: CalendarEntry, names: Record<string, Person> = {}): CardJob {
  const row = { kind: "lead" as const, id: entry.lead_id || entry.key, status: entry.status || "", entry };
  const a = rowAssignee(row, names);
  const scheduledFor = entry.start_time ? `${entry.date}T${entry.start_time}+02:00` : entry.date;
  return {
    kind: "visit", id: row.id, title: entry.customer_name || "Booked lead", scheduledFor,
    statusKey: statusKey(entry.status, !!a), place: place(entry.customer_address), clientName: entry.customer_name,
    assigneeName: a?.name, lane: boardLane(row), callSummary: entry.call_summary, notes: entry.notes,
    urgency: jobUrgency({ id: row.id, status: entry.status, scheduled_for: scheduledFor,
      assignments: a ? [{ profile_id: a.id }] : [] }, new Date()),
  };
}
