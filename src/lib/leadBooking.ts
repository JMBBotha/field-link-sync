import { supabase } from "@/integrations/supabase/client";

/** Statuses after which a lead/job is never shown as "Booked". */
const FINISHED = ["completed", "cancelled", "canceled", "invoiced", "closed", "paid", "resolved_before_visit", "lost"];
/** Work already under way keeps its own label (In progress / En route). */
const UNDER_WAY = ["in_progress", "started", "on_site"];

export interface BookingInfo {
  techName: string | null;
  techId: string | null;
  /** ISO timestamp or YYYY-MM-DD[THH:MM] of the booked slot. */
  when: string | null;
  jobId: string | null;
}

export function isBookableStatus(status?: string | null): boolean {
  const s = (status || "").toLowerCase().trim();
  return !FINISHED.includes(s) && !UNDER_WAY.includes(s);
}

/** "14 Oct 09:30" in SAST; date-only values give "14 Oct". */
export function formatBookingWhen(when?: string | null): string | null {
  if (!when) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(when);
  const d = new Date(dateOnly ? `${when}T12:00:00+02:00` : when);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString("en-ZA", { timeZone: "Africa/Johannesburg", day: "numeric", month: "short" });
  if (dateOnly) return day;
  const time = d.toLocaleTimeString("en-ZA", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day} ${time}`;
}

/** One line for popups: "Booked · Innocent Mattienga · 14 Oct 09:30". */
export function bookingLine(b: BookingInfo): string {
  return ["Booked", b.techName, formatBookingWhen(b.when)].filter(Boolean).join(" · ");
}

interface RawJob {
  id: string;
  lead_id?: string | null;
  status?: string | null;
  scheduled_for?: string | null;
  created_at?: string | null;
  assignments?: { profile_id: string; created_at?: string | null; status?: string | null; profiles?: { full_name?: string | null } | null }[] | null;
}
interface RawSchedule { job_id?: string | null; lead_id?: string | null; agent_id?: string | null; scheduled_date: string; start_time?: string | null }

/** Pure: booking for a job (open + has a tech), else null. */
export function bookingFromJob(job: RawJob, schedule?: RawSchedule | null, names?: Map<string, string>): BookingInfo | null {
  if (!isBookableStatus(job.status)) return null;
  const a = [...(job.assignments || [])]
    .filter((x) => !FINISHED.includes((x.status || "").toLowerCase()))
    .sort((x, y) => String(y.created_at || "").localeCompare(String(x.created_at || "")))[0];
  const techId = a?.profile_id || schedule?.agent_id || null;
  if (!techId) return null;
  const techName = (a?.profiles?.full_name || names?.get(techId) || "").trim() || null;
  const when = job.scheduled_for
    || (schedule ? (schedule.start_time ? `${schedule.scheduled_date}T${schedule.start_time.slice(0, 5)}:00+02:00` : schedule.scheduled_date) : null);
  return { techName, techId, when, jobId: job.id };
}

/** Pure: booking for a lead with its own tech + date (no job yet). */
export function bookingFromLead(lead: { status?: string | null; assigned_agent_id?: string | null; scheduled_date?: string | null; scheduled_time?: string | null }, techName?: string | null): BookingInfo | null {
  if (!isBookableStatus(lead.status) || !lead.assigned_agent_id || !lead.scheduled_date) return null;
  const date = String(lead.scheduled_date).slice(0, 10);
  const when = lead.scheduled_time ? `${date}T${String(lead.scheduled_time).slice(0, 5)}:00+02:00` : date;
  return { techName: techName || null, techId: lead.assigned_agent_id, when, jobId: null };
}

/** Live bookings keyed by lead id, read from the lead's linked open job (assignments + job_schedules). */
export async function fetchLeadBookings(leadIds: string[]): Promise<Map<string, BookingInfo>> {
  const out = new Map<string, BookingInfo>();
  const ids = Array.from(new Set(leadIds.filter(Boolean)));
  if (!ids.length) return out;
  const { data: jobs } = await (supabase as any)
    .from("jobs")
    .select("id, lead_id, status, scheduled_for, created_at, assignments(profile_id, created_at, status, profiles!assignments_profile_id_fkey(full_name))")
    .in("lead_id", ids)
    .order("created_at", { ascending: false });
  const list = ((jobs || []) as RawJob[]).filter((j) => isBookableStatus(j.status));
  const sched = await fetchSchedules(list.map((j) => j.id));
  for (const j of list) {
    if (!j.lead_id || out.has(j.lead_id)) continue;
    const b = bookingFromJob(j, sched.byJob.get(j.id), sched.names);
    if (b) out.set(j.lead_id, b);
  }
  return out;
}

/** Live bookings keyed by job id. */
export async function fetchJobBookings(jobIds: string[]): Promise<Map<string, BookingInfo>> {
  const out = new Map<string, BookingInfo>();
  const ids = Array.from(new Set(jobIds.filter(Boolean)));
  if (!ids.length) return out;
  const { data: jobs } = await (supabase as any)
    .from("jobs")
    .select("id, lead_id, status, scheduled_for, created_at, assignments(profile_id, created_at, status, profiles!assignments_profile_id_fkey(full_name))")
    .in("id", ids);
  const sched = await fetchSchedules(ids);
  for (const j of (jobs || []) as RawJob[]) {
    const b = bookingFromJob(j, sched.byJob.get(j.id), sched.names);
    if (b) out.set(j.id, b);
  }
  return out;
}

async function fetchSchedules(jobIds: string[]) {
  const byJob = new Map<string, RawSchedule>();
  const names = new Map<string, string>();
  if (!jobIds.length) return { byJob, names };
  const { data } = await (supabase as any)
    .from("job_schedules")
    .select("job_id, lead_id, agent_id, scheduled_date, start_time")
    .in("job_id", jobIds)
    .order("scheduled_date", { ascending: true });
  for (const s of (data || []) as RawSchedule[]) if (s.job_id && !byJob.has(s.job_id)) byJob.set(s.job_id, s);
  const agentIds = Array.from(new Set(Array.from(byJob.values()).map((s) => s.agent_id).filter(Boolean))) as string[];
  if (agentIds.length) {
    const { data: ps } = await supabase.from("profiles").select("id, full_name").in("id", agentIds);
    for (const p of (ps || []) as any[]) if (p.full_name) names.set(p.id, p.full_name);
  }
  return { byJob, names };
}
