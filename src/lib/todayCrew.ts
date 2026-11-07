/**
 * "Jobs being done today" on Admin Home.
 * A Johannesburg calendar day, not UTC midnight.
 * Booked that day, started (on site) that day, or completed that day.
 * Cancelled work is left out. Another company's rows are left out.
 */
import { inSignedInCompany } from "@/lib/adminHomeCount";
import { jhbDate } from "@/lib/drilldown";

const CANCELLED = new Set(["cancelled", "canceled", "resolved_before_visit"]);

export interface TodayJobRow {
  id: string;
  company_id?: string | null;
  status?: string | null;
  job_type?: string | null;
  title?: string | null;
  scheduled_for?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  customer_name?: string | null;
  address?: string | null;
  assignee?: string | null;
}

export interface TodayScheduleRow {
  jobId: string;
  who?: string | null;
  where?: string | null;
  client?: string | null;
}

export interface TodayCrewCard {
  id: string;
  href: string;
  who: string;
  type: string;
  where: string;
  client: string;
}

export function nextCalendarDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

/** Inclusive start, exclusive end, both Africa/Johannesburg (UTC+2, no daylight saving). */
export function johannesburgDayBounds(day: string): { start: string; end: string } {
  return { start: `${day}T00:00:00+02:00`, end: `${nextCalendarDay(day)}T00:00:00+02:00` };
}

export function countsOnJohannesburgDay(
  job: Pick<TodayJobRow, "status" | "scheduled_for" | "started_at" | "completed_at">,
  day: string,
): boolean {
  if (CANCELLED.has(String(job.status || "").toLowerCase())) return false;
  return jhbDate(job.scheduled_for) === day || jhbDate(job.started_at) === day || jhbDate(job.completed_at) === day;
}

/**
 * Schedule rows are already the bookings for `day` (job_schedules / lead date).
 * Jobs completed or started that day are added even when the booking date is earlier,
 * so finished work does not vanish. A job dated another day, and not booked today, stays off the card.
 */
export function mergeTodayCrew(input: {
  companyId: string;
  day: string;
  schedule: TodayScheduleRow[];
  jobs: TodayJobRow[];
}): TodayCrewCard[] {
  const jobs = new Map<string, TodayJobRow>();
  for (const job of input.jobs) {
    if (!inSignedInCompany(job.company_id, input.companyId)) continue;
    if (CANCELLED.has(String(job.status || "").toLowerCase())) continue;
    jobs.set(job.id, job);
  }
  const out: TodayCrewCard[] = [];
  const seen = new Set<string>();
  const push = (job: TodayJobRow, over?: { who?: string | null; where?: string | null; client?: string | null }) => {
    if (seen.has(job.id)) return;
    seen.add(job.id);
    out.push({
      id: job.id,
      href: `/admin/jobs/${job.id}`,
      who: (over?.who || job.assignee || "").trim() || "Unassigned",
      type: job.job_type || job.title || "Job",
      where: (over?.where || job.address || job.title || "Job").trim() || "Job",
      client: (over?.client || job.customer_name || "Client").trim() || "Client",
    });
  };
  for (const row of input.schedule) {
    const job = jobs.get(row.jobId);
    if (!job) continue;
    push(job, row);
  }
  for (const job of jobs.values()) {
    if (countsOnJohannesburgDay(job, input.day)) push(job);
  }
  return out;
}
