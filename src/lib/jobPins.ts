import { supabase } from "@/integrations/supabase/client";
import { hasValidCoords } from "@/lib/leadCoords";
import { geocodeAddress } from "@/lib/geocodeAddress";
import { fetchJobBookings, type BookingInfo } from "@/lib/leadBooking";

/** Job statuses that are finished and never shown as map pins. */
export const CLOSED_JOB_STATUSES = ["completed", "cancelled", "canceled", "invoiced", "closed", "paid"];

export function isOpenJobStatus(status?: string | null): boolean {
  return !CLOSED_JOB_STATUSES.includes((status || "").toLowerCase().trim());
}

export interface JobPin {
  id: string;
  title: string;
  status: string;
  address: string | null;
  scheduled_for: string | null;
  customer_name: string | null;
  /** Assigned tech + booked slot when the open job has a tech (shown as "Booked"). */
  booking?: BookingInfo | null;
  lat: number;
  lng: number;
}

interface RawJob {
  id: string;
  title?: string | null;
  status?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  scheduled_for?: string | null;
  customer_id?: string | null;
  lead_id?: string | null;
  customers?: { name?: string | null } | null;
}

/** Pure: pick coords for a job — own coords, then linked lead, then customer location. */
export function pickJobCoords(
  job: RawJob,
  leadCoords: Map<string, { lat: number; lng: number }>,
  customerCoords: Map<string, { lat: number; lng: number }>
): { lat: number; lng: number } | null {
  if (hasValidCoords(job.lat, job.lng)) return { lat: Number(job.lat), lng: Number(job.lng) };
  if (job.lead_id && leadCoords.has(job.lead_id)) return leadCoords.get(job.lead_id)!;
  if (job.customer_id && customerCoords.has(job.customer_id)) return customerCoords.get(job.customer_id)!;
  return null;
}

/**
 * Open jobs for the map, scoped to the company. When techOnlyUserId is set
 * (field techs), only jobs scheduled/assigned to that tech are returned.
 */
export async function fetchJobPins(companyId: string, techOnlyUserId?: string | null): Promise<JobPin[]> {
  let q = (supabase as any)
    .from("jobs")
    .select("id, title, status, address, lat, lng, scheduled_for, customer_id, lead_id, customers(name)")
    .eq("company_id", companyId)
    .not("status", "in", `(${CLOSED_JOB_STATUSES.join(",")})`);
  if (techOnlyUserId) {
    const { data: sched } = await (supabase as any)
      .from("job_schedules")
      .select("job_id")
      .eq("agent_id", techOnlyUserId)
      .not("job_id", "is", null);
    const ids = Array.from(new Set(((sched || []) as any[]).map((r) => r.job_id)));
    if (ids.length === 0) return [];
    q = q.in("id", ids);
  }
  const { data, error } = await q;
  if (error) throw error;
  const jobs = ((data || []) as RawJob[]).filter((j) => isOpenJobStatus(j.status));

  const leadIds = jobs.filter((j) => !hasValidCoords(j.lat, j.lng) && j.lead_id).map((j) => j.lead_id!) ;
  const custIds = jobs.filter((j) => !hasValidCoords(j.lat, j.lng) && j.customer_id).map((j) => j.customer_id!);
  const leadCoords = new Map<string, { lat: number; lng: number }>();
  const customerCoords = new Map<string, { lat: number; lng: number }>();
  if (leadIds.length) {
    const { data: ls } = await supabase.from("leads").select("id, latitude, longitude").in("id", leadIds);
    for (const l of (ls || []) as any[]) if (hasValidCoords(l.latitude, l.longitude)) leadCoords.set(l.id, { lat: Number(l.latitude), lng: Number(l.longitude) });
  }
  if (custIds.length) {
    const { data: cl } = await (supabase as any)
      .from("customer_locations")
      .select("customer_id, latitude, longitude, is_primary")
      .in("customer_id", custIds);
    for (const c of (cl || []) as any[]) {
      if (!hasValidCoords(c.latitude, c.longitude)) continue;
      if (!customerCoords.has(c.customer_id) || c.is_primary) customerCoords.set(c.customer_id, { lat: Number(c.latitude), lng: Number(c.longitude) });
    }
  }

  const bookings = await fetchJobBookings(jobs.map((j) => j.id)).catch(() => new Map<string, BookingInfo>());
  const out: JobPin[] = [];
  for (const j of jobs) {
    let c = pickJobCoords(j, leadCoords, customerCoords);
    if (!c && j.address && j.address.trim().length >= 5) {
      const g = await geocodeAddress(j.address);
      if (g && hasValidCoords(g.latitude, g.longitude)) c = { lat: g.latitude, lng: g.longitude };
    }
    if (!c) continue;
    out.push({
      id: j.id,
      title: j.title || "Job",
      status: j.status || "scheduled",
      address: j.address ?? null,
      scheduled_for: j.scheduled_for ?? null,
      customer_name: j.customers?.name ?? null,
      booking: bookings.get(j.id) ?? null,
      lat: c.lat,
      lng: c.lng,
    });
  }
  return out;
}
