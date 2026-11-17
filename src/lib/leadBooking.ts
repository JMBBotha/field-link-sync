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
  /** Service / Sales / Install. Optional so older callers keep the Booked line. */
  kind?: string | null;
  end?: string | null;
  personRole?: "technician" | "sales" | null;
  noTechnician?: boolean;
  ownerName?: string | null;
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

export type BookingPersonRole = "technician" | "sales" | null;

/** Fields for the shared booking line. A sales owner is not a technician. */
export interface BookingSummaryInput {
  kind?: string | null;
  personName?: string | null;
  personRole?: BookingPersonRole;
  /** YYYY-MM-DD */
  date?: string | null;
  /** HH:MM or HH:MM:SS */
  start?: string | null;
  end?: string | null;
  noTechnician?: boolean;
}

/** A service / repair / install visit needs a technician. A sales or quote visit does not. */
export function isServiceBooking(input: {
  primary_intent?: string | null;
  service_type?: string | null;
  job_type?: string | null;
  job_types?: string[] | null;
}): boolean {
  const intent = (input.primary_intent || "").toLowerCase();
  const blob = `${input.service_type || ""} ${input.job_type || ""}`.toLowerCase();
  if (intent === "sales" || intent === "quote") return false;
  if (/(sales visit|quote visit|consult|survey)/.test(blob) && !/(service|repair|install|call)/.test(blob)) return false;
  if (["service", "repair", "installation", "technical"].includes(intent)) return true;
  if ((input.job_types || []).some((t) => ["service", "repair", "installation"].includes(String(t).toLowerCase()))) return true;
  return /(service|repair|install|call|fault|maintenance|commission|technical)/.test(blob);
}

/** Short kind for the summary. Sales visits stay "Sales". */
export function bookingKindLabel(input: {
  primary_intent?: string | null;
  service_type?: string | null;
  job_type?: string | null;
  job_types?: string[] | null;
}): string {
  if (!isServiceBooking(input)) return "Sales";
  const blob = `${input.service_type || ""} ${input.job_type || ""}`.toLowerCase();
  if (/install/.test(blob)) return "Install";
  return "Service";
}

/** Only a company technician may occupy the visit's agent slot on a service booking. */
export function visitAgentId(personId: string | null | undefined, isTechnician: boolean, service: boolean): string | null {
  if (!personId) return null;
  if (!service) return personId;
  return isTechnician ? personId : null;
}

const clock = (t?: string | null) => {
  if (!t) return null;
  const m = String(t).match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
};

/** "Thu 19 Nov" in Johannesburg. No comma. */
export function formatBookingDay(date?: string | null): string | null {
  if (!date) return null;
  const day = String(date).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const d = new Date(`${day}T12:00:00+02:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-ZA", { timeZone: "Africa/Johannesburg", weekday: "short", day: "numeric", month: "short" }).replace(/,/g, "");
}

export interface BookingSummaryParts {
  kind: string;
  /** Name, or the sales-owner phrase. Null when the red chip stands in for the name. */
  who: string | null;
  chip: boolean;
  when: string | null;
}

/**
 * "Service · Innocent Mattienga · Thu 19 Nov · 10:00–13:00".
 * No technician: the name slot is a red chip.
 * A salesperson on a service visit: "Almari Cloete (sales) · no technician yet".
 */
export function bookingSummaryParts(input: BookingSummaryInput): BookingSummaryParts {
  const kind = (input.kind || "Service").trim() || "Service";
  const start = clock(input.start);
  const end = clock(input.end);
  const range = start && end ? `${start}–${end}` : start;
  const day = formatBookingDay(input.date);
  const when = [day, range].filter(Boolean).join(" · ") || null;
  const name = (input.personName || "").trim();
  const salesOwner = input.personRole === "sales" && !!name;
  if (salesOwner) return { kind, who: `${name} (sales) · no technician yet`, chip: false, when };
  if (input.personRole === "technician" && name && !input.noTechnician) return { kind, who: name, chip: false, when };
  if (name && !input.noTechnician && input.personRole !== "sales") return { kind, who: name, chip: false, when };
  return { kind, who: null, chip: true, when };
}

/** Plain-text summary. The chip is the words "No technician". */
export function bookingSummaryLine(input: BookingSummaryInput): string {
  const p = bookingSummaryParts(input);
  return [p.kind, p.chip ? "No technician" : p.who, p.when].filter(Boolean).join(" · ");
}

export function summaryFromBookingInfo(b: BookingInfo): BookingSummaryInput {
  const date = b.when ? String(b.when).slice(0, 10) : null;
  const start = b.when && b.when.includes("T") ? String(b.when).slice(11, 16) : null;
  return {
    kind: b.kind || "Service",
    personName: b.personRole === "sales" ? (b.ownerName || b.techName) : b.techName,
    personRole: b.personRole ?? (b.noTechnician ? null : b.techName ? "technician" : null),
    date,
    start,
    end: b.end,
    noTechnician: !!b.noTechnician,
  };
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
