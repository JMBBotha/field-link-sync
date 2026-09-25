/**
 * ONE definition of "today's jobs" — same source as /admin/dispatch:
 * job_schedules rows PLUS leads that have a person + date but no lead-level
 * job_schedules row yet (dispatch LOCKED rule). Leads without a person+date
 * never count. Dates are Africa/Johannesburg calendar days.
 */
import { supabase } from "@/integrations/supabase/client";

export const CLOSED_STATUSES = ["completed", "cancelled", "canceled"];
const isClosed = (s?: string | null) => CLOSED_STATUSES.includes(String(s || "").toLowerCase());
const isCompleted = (s?: string | null) => String(s || "").toLowerCase() === "completed";

/** 'YYYY-MM-DD' in Africa/Johannesburg. Never toISOString. */
export function todayInJohannesburg(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

export type CalendarEntry = {
  key: string;
  date: string;
  start_time: string | null;
  lead_id: string | null;
  job_id: string | null;
  agent_id: string | null;
  status: string | null;
  customer_name: string | null;
  customer_address: string | null;
};

export type ScheduleRowIn = {
  id: string; lead_id: string | null; job_id: string | null; agent_id: string | null;
  scheduled_date: string; start_time: string | null;
  leads?: { customer_name?: string | null; customer_address?: string | null; status?: string | null } | null;
  jobs?: { status?: string | null } | null;
};
export type LeadRowIn = {
  id: string; assigned_agent_id: string | null; scheduled_date: string | null; scheduled_time?: string | null;
  status: string | null; customer_name?: string | null; customer_address?: string | null;
};

/** Merge schedule rows + scheduled leads, de-duplicated by job_id / lead_id. */
export function buildCalendarEntries(schedules: ScheduleRowIn[], leads: LeadRowIn[]): CalendarEntry[] {
  const out = new Map<string, CalendarEntry>();
  for (const s of schedules) {
    const key = s.job_id ? `job:${s.job_id}` : `lead:${s.lead_id}`;
    if (out.has(key)) continue;
    out.set(key, {
      key, date: s.scheduled_date, start_time: s.start_time, lead_id: s.lead_id, job_id: s.job_id,
      agent_id: s.agent_id, status: s.job_id ? (s.jobs?.status ?? s.leads?.status ?? null) : (s.leads?.status ?? null),
      customer_name: s.leads?.customer_name ?? null, customer_address: s.leads?.customer_address ?? null,
    });
  }
  for (const l of leads) {
    if (!l.assigned_agent_id || !l.scheduled_date) continue; // leads-only never count
    const key = `lead:${l.id}`;
    if (out.has(key)) continue;
    out.set(key, {
      key, date: l.scheduled_date, start_time: l.scheduled_time ?? null, lead_id: l.id, job_id: null,
      agent_id: l.assigned_agent_id, status: l.status, customer_name: l.customer_name ?? null,
      customer_address: l.customer_address ?? null,
    });
  }
  return [...out.values()].sort((a, b) =>
    a.date.localeCompare(b.date) || String(a.start_time || "").localeCompare(String(b.start_time || "")));
}

export function summarizeDay(entries: CalendarEntry[], date: string, agentId?: string) {
  const day = entries.filter((e) => e.date === date && (!agentId || e.agent_id === agentId));
  const open = day.filter((e) => !isClosed(e.status));
  const completed = day.filter((e) => isCompleted(e.status)).length;
  return { open, completed, total: open.length + completed };
}

export function overdueEntries(entries: CalendarEntry[], today: string, agentId?: string) {
  return entries.filter((e) => e.date < today && !isClosed(e.status) && (!agentId || e.agent_id === agentId));
}

async function loadEntries(opts: { date?: string; before?: string; agentId?: string }): Promise<CalendarEntry[]> {
  let sq = supabase
    .from("job_schedules")
    .select("id, lead_id, job_id, agent_id, scheduled_date, start_time, leads(customer_name, customer_address, status), jobs(status)");
  let lq = supabase
    .from("leads")
    .select("id, assigned_agent_id, scheduled_date, scheduled_time, status, customer_name, customer_address")
    .not("assigned_agent_id", "is", null)
    .not("scheduled_date", "is", null)
    .is("deleted_at", null);
  if (opts.date) { sq = sq.eq("scheduled_date", opts.date); lq = lq.eq("scheduled_date", opts.date); }
  if (opts.before) { sq = sq.lt("scheduled_date", opts.before); lq = lq.lt("scheduled_date", opts.before); }
  if (opts.agentId) { sq = sq.eq("agent_id", opts.agentId); lq = lq.eq("assigned_agent_id", opts.agentId); }
  const [s, l] = await Promise.all([sq, lq]);
  if (s.error) throw s.error;
  if (l.error) throw l.error;
  // Lead-level rows suppress synthesized lead tiles (same as dispatch); install rows keyed by job_id.
  return buildCalendarEntries((s.data || []) as any, (l.data || []) as any);
}

export async function fetchTodaysJobs({ date = todayInJohannesburg(), agentId }: { date?: string; agentId?: string } = {}) {
  const entries = await loadEntries({ date, agentId });
  return summarizeDay(entries, date, agentId);
}

export async function fetchOverdue({ agentId }: { agentId?: string } = {}) {
  const today = todayInJohannesburg();
  return overdueEntries(await loadEntries({ before: today, agentId }), today, agentId);
}
