import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type NeedsResched = { key: string; leadId: string; jobId: string | null; name: string; reason: string; since: string };

/** Bookings moved to "Needs rescheduling" (status_change_log field needs_reschedule) that are still active and not rebooked.
 *  Cancelled / completed ones drop out; so does anything that has a date again. */
export function useNeedsReschedule(enabled = true) {
  return useQuery({
    queryKey: ["needs-reschedule"],
    enabled,
    refetchInterval: 60_000,
    queryFn: async (): Promise<NeedsResched[]> => {
      const { data: logs } = await (supabase.from("status_change_log") as any)
        .select("entity_type, entity_id, new_status, created_at").eq("field_name", "needs_reschedule").order("created_at", { ascending: false }).limit(300);
      const latest = new Map<string, any>();
      ((logs || []) as any[]).forEach((r) => { if (!latest.has(r.entity_id)) latest.set(r.entity_id, r); });
      const rows = [...latest.values()];
      const jobIds = rows.filter((r) => r.entity_type === "job").map((r) => r.entity_id);
      const leadIds = rows.filter((r) => r.entity_type === "lead").map((r) => r.entity_id);
      const [j, l] = await Promise.all([
        jobIds.length ? (supabase.from("jobs") as any).select("id, lead_id, title, status, scheduled_for").in("id", jobIds) : { data: [] },
        leadIds.length ? (supabase.from("leads") as any).select("id, customer_name, status, scheduled_date, assigned_agent_id").in("id", leadIds) : { data: [] },
      ]);
      const out: NeedsResched[] = [];
      ((j.data || []) as any[]).forEach((x) => {
        if (x.scheduled_for || ["completed", "cancelled"].includes(String(x.status))) return;
        const r = latest.get(x.id); out.push({ key: `j${x.id}`, leadId: x.lead_id, jobId: x.id, name: x.title || "Job", reason: r.new_status, since: r.created_at });
      });
      ((l.data || []) as any[]).forEach((x) => {
        if (x.scheduled_date || ["completed", "cancelled", "resolved_before_visit"].includes(String(x.status))) return;
        const r = latest.get(x.id); out.push({ key: `l${x.id}`, leadId: x.id, jobId: null, name: x.customer_name || "Booking", reason: r.new_status, since: r.created_at });
      });
      return out.sort((a, b) => a.since.localeCompare(b.since));
    },
  });
}
