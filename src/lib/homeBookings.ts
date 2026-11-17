import { supabase } from "@/integrations/supabase/client";
import { jhbDate } from "@/lib/drilldown";
import { bookingKindLabel, bookingSummaryLine, isServiceBooking, type BookingSummaryInput } from "@/lib/leadBooking";
import { jobToCard, type CardJob } from "@/lib/cardModel";

export interface HomeListItem {
  key: string;
  href: string;
  card: CardJob;
}

type JobRow = {
  id: string;
  lead_id?: string | null;
  status?: string | null;
  scheduled_for?: string | null;
  job_type?: string | null;
  title?: string | null;
};

type ScheduleRow = {
  id: string;
  lead_id?: string | null;
  agent_id?: string | null;
  scheduled_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  leads?: {
    customer_name?: string | null;
    status?: string | null;
    service_type?: string | null;
    primary_intent?: string | null;
    customer_address?: string | null;
    assigned_agent_id?: string | null;
  } | null;
};

const CLOSED = new Set(["cancelled", "canceled", "completed", "resolved_before_visit"]);

/**
 * Jobs plus lead-only bookings in the same window.
 * A schedule is left out when a job for that lead already falls on that day.
 */
export function upcomingHomeCards(
  jobs: JobRow[],
  schedules: ScheduleRow[],
  names: ReadonlyMap<string, { name: string; role: string | null }> = new Map(),
): HomeListItem[] {
  const covered = new Set<string>();
  const items: HomeListItem[] = [];
  for (const job of jobs) {
    if (CLOSED.has(String(job.status || "").toLowerCase())) continue;
    const day = jhbDate(job.scheduled_for);
    if (job.lead_id && day) covered.add(`${job.lead_id}|${day}`);
    const card = jobToCard(job as Parameters<typeof jobToCard>[0]);
    const person = card.assigneeName;
    const summary: BookingSummaryInput = {
      kind: bookingKindLabel({ job_type: job.job_type, service_type: job.title }),
      personName: person,
      personRole: person ? "technician" : null,
      date: day,
      start: job.scheduled_for && job.scheduled_for.includes("T") ? job.scheduled_for.slice(11, 16) : null,
      noTechnician: isServiceBooking({ job_type: job.job_type, service_type: job.title }) && !person,
    };
    items.push({ key: job.id, href: `/admin/jobs/${job.id}`, card: { ...card, summary: bookingSummaryLine(summary), summaryInput: summary } });
  }
  for (const row of schedules) {
    const day = String(row.scheduled_date || "").slice(0, 10);
    const lead = row.leads;
    if (!row.lead_id || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    if (CLOSED.has(String(lead?.status || "").toLowerCase())) continue;
    if (covered.has(`${row.lead_id}|${day}`)) continue;
    covered.add(`${row.lead_id}|${day}`);
    const agent = row.agent_id ? names.get(row.agent_id) : undefined;
    const owner = lead?.assigned_agent_id ? names.get(lead.assigned_agent_id) : undefined;
    const tech = agent && (agent.role || "technician") === "technician" ? agent.name : null;
    const sales = (owner?.role || "") === "sales" || (owner?.role || "") === "sales_engineer";
    const service = isServiceBooking({ primary_intent: lead?.primary_intent, service_type: lead?.service_type });
    const summary: BookingSummaryInput = {
      kind: bookingKindLabel({ primary_intent: lead?.primary_intent, service_type: lead?.service_type }),
      personName: tech || (sales ? owner?.name : null),
      personRole: tech ? "technician" : sales ? "sales" : null,
      date: day,
      start: row.start_time,
      end: row.end_time,
      noTechnician: service && !tech,
    };
    const start = (row.start_time || "08:00").slice(0, 5);
    items.push({
      key: `lead:${row.id}`,
      href: `/admin/bookings/${row.lead_id}`,
      card: {
        kind: "visit",
        id: row.lead_id,
        title: lead?.customer_name || "Booking",
        scheduledFor: `${day}T${start}:00+02:00`,
        statusKey: "scheduled",
        place: lead?.customer_address || null,
        clientName: lead?.customer_name || null,
        lane: service ? "service" : "sales",
        assigneeName: tech,
        urgency: { key: "later", rank: 6, mins: null },
        summary: bookingSummaryLine(summary),
        summaryInput: summary,
      },
    });
  }
  return items.sort((a, b) => String(a.card.scheduledFor || "").localeCompare(String(b.card.scheduledFor || "")));
}

/** Lead-only bookings for the home Today / Week / Month list. A failed read leaves the jobs list as it was. */
export async function homeCards(jobs: JobRow[], from: string, to: string): Promise<HomeListItem[]> {
  const { data, error } = await (supabase.from("job_schedules") as any)
    .select("id, lead_id, agent_id, scheduled_date, start_time, end_time, leads(customer_name, status, service_type, primary_intent, customer_address, assigned_agent_id)")
    .is("job_id", null)
    .gte("scheduled_date", from)
    .lt("scheduled_date", to)
    .limit(100);
  if (error || !data) return upcomingHomeCards(jobs, []);
  const rows = data as ScheduleRow[];
  const ids = [...new Set(rows.flatMap((row) => [row.agent_id, row.leads?.assigned_agent_id].filter(Boolean)))] as string[];
  const names = new Map<string, { name: string; role: string | null }>();
  if (ids.length) {
    const people = await supabase.from("profiles").select("id, full_name, dispatch_role").in("id", ids);
    for (const person of (people.data || []) as { id: string; full_name: string | null; dispatch_role: string | null }[]) {
      names.set(person.id, { name: person.full_name || "Technician", role: person.dispatch_role });
    }
  }
  return upcomingHomeCards(jobs, rows, names);
}
