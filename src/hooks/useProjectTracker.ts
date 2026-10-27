import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { moneyByHouse, sortHouses, type ProjectHouse, type ProjectPhase, type HouseMoney } from "@/lib/projectTracker";

// Tables are new (20261027130000_project_house_tracker.sql); typed loosely until types are regenerated.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- new tables not in generated types yet
export const db = supabase as any;

export interface ProjectRow { id: string; company_id: string; customer_id: string; name: string; code: string | null; po_number: string | null; default_make: string | null; status: string; notes: string | null; created_at: string; customers?: { company_name: string | null; first_name?: string | null; last_name?: string | null } | null }

export function useProjects(customerId?: string) {
  return useQuery({
    queryKey: ["projects", customerId ?? "all"],
    queryFn: async () => {
      let q = db.from("projects").select("id, company_id, customer_id, name, code, po_number, default_make, status, notes, created_at, customers(company_name, first_name, last_name), project_houses(count)").order("created_at", { ascending: false });
      if (customerId) q = q.eq("customer_id", customerId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as (ProjectRow & { project_houses: { count: number }[] })[];
    },
  });
}

export function useProjectDetail(projectId?: string) {
  return useQuery({
    enabled: !!projectId,
    queryKey: ["project-detail", projectId],
    queryFn: async () => {
      const [p, ph, hs] = await Promise.all([
        db.from("projects").select("*, customers(company_name, first_name, last_name)").eq("id", projectId).maybeSingle(),
        db.from("project_phases").select("*").eq("project_id", projectId).order("sort_order"),
        db.from("project_houses").select("*, steps:project_house_steps(*)").eq("project_id", projectId),
      ]);
      for (const r of [p, ph, hs]) if (r.error) throw r.error;
      const houses = sortHouses(((hs.data || []) as ProjectHouse[]).map((h) => ({ ...h, steps: [...(h.steps || [])].sort((a, b) => a.sort_order - b.sort_order) })));
      const ids = houses.map((h) => h.id);
      let money: Record<string, HouseMoney> = {};
      if (ids.length) {
        const inv = await db.from("invoices").select("id, project_house_id, grand_total, status, invoice_number, archived_at").in("project_house_id", ids);
        if (inv.error) throw inv.error;
        const invIds = (inv.data || []).map((i: { id: string }) => i.id);
        const pay = invIds.length ? await db.from("payments").select("invoice_id, amount, status").in("invoice_id", invIds) : { data: [] };
        money = moneyByHouse(inv.data || [], pay.data || []);
      }
      return { project: p.data as ProjectRow | null, phases: (ph.data || []) as ProjectPhase[], houses, money };
    },
  });
}

export function useInvalidateProject() {
  const qc = useQueryClient();
  return (projectId?: string) => { qc.invalidateQueries({ queryKey: ["project-detail", projectId] }); qc.invalidateQueries({ queryKey: ["projects"] }); };
}

export const clientName = (c?: ProjectRow["customers"]) => c?.company_name || [c?.first_name, c?.last_name].filter(Boolean).join(" ") || "Client";
