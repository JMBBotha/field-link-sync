/**
 * Live-map "Completed Jobs" list. A row is a job that is finished now.
 * Lead status "converted" or "completed" is not enough: a converted lead whose
 * job was scheduled or reopened stays off this list. Cancelled is not completion.
 */
import { supabase } from "@/integrations/supabase/client";
import { hasValidCoords } from "@/lib/leadCoords";
import { jobHref } from "@/lib/recordLinks";

/** Finished work. Same set the balance-invoice guard treats as a done job, plus paid.
 *  Reopen writes scheduled or in_progress and is not in this set. Cancelled is closed, not done. */
export const FINISHED_JOB_STATUSES = ["completed", "done", "invoiced", "closed", "paid"] as const;

export function isGenuinelyCompletedJobStatus(status?: string | null): boolean {
  return (FINISHED_JOB_STATUSES as readonly string[]).includes(String(status || "").toLowerCase().trim());
}

export type CompletedMapLead = {
  id?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_address?: string | null;
  service_type?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  deleted_at?: string | null;
  merged_into_id?: string | null;
  company_id?: string | null;
};

export type CompletedMapCompletion = {
  status?: string | null;
  completed_at?: string | null;
  technician_id?: string | null;
  technician_name?: string | null;
};

export type CompletedMapJob = {
  id: string;
  company_id?: string | null;
  status?: string | null;
  title?: string | null;
  job_type?: string | null;
  address?: string | null;
  completed_at?: string | null;
  lat?: number | null;
  lng?: number | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  lead?: CompletedMapLead | null;
  /** Who is assigned. Never used as "Completed by". Used only so a tech still sees their own finished job. */
  assignee_ids?: string[] | null;
  completion?: CompletedMapCompletion | null;
};

export type CompletedMapCard = {
  jobId: string;
  leadId: string | null;
  name: string;
  service: string | null;
  address: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  completedAt: string | null;
  completedBy: string | null;
  href: string;
};

const tidy = (s?: string | null) => (s || "").replace(/\s+/g, " ").trim();

function leadHidden(lead?: CompletedMapLead | null): boolean {
  if (!lead) return false;
  return !!lead.deleted_at || !!lead.merged_into_id;
}

/** Office sees the company's finished jobs. A tech sees a job they finished or are still assigned to. */
export function completedMapCards(args: {
  jobs: CompletedMapJob[];
  companyId: string;
  techId?: string | null;
  jobHref?: (id: string) => string;
}): CompletedMapCard[] {
  const hrefFor = args.jobHref || jobHref;
  const cards: CompletedMapCard[] = [];
  for (const job of args.jobs) {
    if (!job?.id || job.company_id !== args.companyId) continue;
    if (!isGenuinelyCompletedJobStatus(job.status)) continue;
    const lead = job.lead || null;
    if (leadHidden(lead)) continue;
    if (lead?.company_id && lead.company_id !== args.companyId) continue;
    if (args.techId) {
      const mine = job.completion?.technician_id === args.techId || (job.assignee_ids || []).includes(args.techId);
      if (!mine) continue;
    }
    const completion = job.completion && isGenuinelyCompletedJobStatus(job.completion.status) ? job.completion : null;
    const completedAt = job.completed_at || completion?.completed_at || null;
    const completedBy = tidy(completion?.technician_name) || null;
    const name = tidy(lead?.customer_name) || tidy(job.customer_name) || tidy(job.title) || "Job";
    const service = tidy(lead?.service_type) || tidy(job.job_type) || tidy(job.title) || null;
    const address = tidy(lead?.customer_address) || tidy(job.address) || null;
    const phone = tidy(lead?.customer_phone) || tidy(job.customer_phone) || null;
    const lat = hasValidCoords(lead?.latitude, lead?.longitude) ? Number(lead?.latitude) : hasValidCoords(job.lat, job.lng) ? Number(job.lat) : null;
    const lng = lat == null ? null : hasValidCoords(lead?.latitude, lead?.longitude) ? Number(lead?.longitude) : Number(job.lng);
    cards.push({
      jobId: job.id,
      leadId: lead?.id || null,
      name, service, address, phone, lat, lng,
      completedAt, completedBy,
      href: hrefFor(job.id),
    });
  }
  return cards.sort((a, b) => {
    if (a.completedAt && b.completedAt && a.completedAt !== b.completedAt) return a.completedAt < b.completedAt ? 1 : -1;
    if (a.completedAt && !b.completedAt) return -1;
    if (!a.completedAt && b.completedAt) return 1;
    return a.name.localeCompare(b.name);
  });
}

export function withCompletedJobCount<T extends { completed: number }>(counts: T, completedJobs: number): T {
  return { ...counts, completed: completedJobs };
}

type RawJob = {
  id: string;
  title?: string | null;
  status?: string | null;
  job_type?: string | null;
  address?: string | null;
  company_id?: string | null;
  lead_id?: string | null;
  completed_at?: string | null;
  lat?: number | null;
  lng?: number | null;
  customers?: { name?: string | null; phone?: string | null } | { name?: string | null; phone?: string | null }[] | null;
  leads?: CompletedMapLead | CompletedMapLead[] | null;
};

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] || null : v || null);

/** Load finished jobs for this company. RLS still applies. Does not write. */
export async function fetchCompletedMapJobs(args: {
  companyId: string;
  techId?: string | null;
  jobHref?: (id: string) => string;
}): Promise<CompletedMapCard[]> {
  const { data, error } = await supabase.from("jobs")
    .select("id, title, status, job_type, address, company_id, lead_id, completed_at, lat, lng, customers(name, phone), leads!jobs_lead_id_fkey(id, customer_name, customer_phone, customer_address, service_type, latitude, longitude, deleted_at, merged_into_id, company_id)")
    .eq("company_id", args.companyId)
    .in("status", [...FINISHED_JOB_STATUSES]);
  if (error) throw error;
  const rows = (data || []) as RawJob[];
  const ids = rows.map((j) => j.id);
  const completions: { job_id: string | null; status: string | null; completed_at: string | null; technician_id: string | null }[] = [];
  const assignments: { job_id: string | null; profile_id: string | null; status: string | null }[] = [];
  if (ids.length) {
    const [c, a] = await Promise.all([
      supabase.from("job_completions").select("job_id, status, completed_at, technician_id").in("job_id", ids),
      supabase.from("assignments").select("job_id, profile_id, status").in("job_id", ids),
    ]);
    if (c.error) throw c.error;
    if (a.error) throw a.error;
    completions.push(...((c.data || []) as typeof completions));
    assignments.push(...((a.data || []) as typeof assignments));
  }
  const techIds = [...new Set(completions.map((c) => c.technician_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (techIds.length) {
    const { data: profiles, error: pErr } = await supabase.from("profiles").select("id, full_name").in("id", techIds);
    if (pErr) throw pErr;
    for (const p of profiles || []) if (p.full_name) names.set(p.id, p.full_name);
  }
  const byJob = new Map<string, CompletedMapCompletion>();
  for (const c of completions) {
    if (!c.job_id || !isGenuinelyCompletedJobStatus(c.status)) continue;
    const prev = byJob.get(c.job_id);
    if (prev && (prev.completed_at || "") >= (c.completed_at || "")) continue;
    byJob.set(c.job_id, {
      status: c.status,
      completed_at: c.completed_at,
      technician_id: c.technician_id,
      technician_name: (c.technician_id && names.get(c.technician_id)) || null,
    });
  }
  const assignees = new Map<string, string[]>();
  for (const a of assignments) {
    if (!a.job_id || !a.profile_id) continue;
    if (["rejected", "canceled", "cancelled"].includes(String(a.status || "").toLowerCase())) continue;
    const list = assignees.get(a.job_id) || [];
    list.push(a.profile_id);
    assignees.set(a.job_id, list);
  }
  return completedMapCards({
    companyId: args.companyId,
    techId: args.techId,
    jobHref: args.jobHref,
    jobs: rows.map((j) => {
      const customer = one(j.customers);
      return {
        id: j.id,
        company_id: j.company_id,
        status: j.status,
        title: j.title,
        job_type: j.job_type,
        address: j.address,
        completed_at: j.completed_at,
        lat: j.lat,
        lng: j.lng,
        customer_name: customer?.name,
        customer_phone: customer?.phone,
        lead: one(j.leads),
        assignee_ids: assignees.get(j.id) || [],
        completion: byJob.get(j.id) || null,
      };
    }),
  });
}
