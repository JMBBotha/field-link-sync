import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { moneyByHouse, photosByHouse, type HousePhotos, docsByHouse, directJobsByHouse, type HouseDocs, sortHouses, type ProjectHouse, type ProjectPhase, type HouseMoney } from "@/lib/projectTracker";

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
      let photos: Record<string, HousePhotos> = {};
      let docs: Record<string, HouseDocs> = {};
      if (ids.length) {
        const inv = await db.from("invoices").select("id, project_house_id, grand_total, status, invoice_number, archived_at, sent_at, issue_date, lead_id").in("project_house_id", ids);
        if (inv.error) throw inv.error;
        const invIds = (inv.data || []).map((i: { id: string }) => i.id);
        const pay = invIds.length ? await db.from("payments").select("invoice_id, amount, status").in("invoice_id", invIds) : { data: [] };
        money = moneyByHouse(inv.data || [], pay.data || []);
        // Jobs per house (display only): via the house's invoices (invoice_id or the invoice's lead) PLUS a direct match
        // (same client's jobs whose title names "House <n>"), so un-invoiced houses still find their job. Deduped.
        const leadIds = [...new Set((inv.data || []).map((i: { lead_id: string | null }) => i.lead_id).filter(Boolean))] as string[];
        const custId = (p.data as ProjectRow | null)?.customer_id;
        const [jq, dq] = await Promise.all([
          invIds.length ? db.from("jobs").select("id, title, invoice_id, lead_id").or([`invoice_id.in.(${invIds.join(",")})`, leadIds.length ? `lead_id.in.(${leadIds.join(",")})` : ""].filter(Boolean).join(",")) : Promise.resolve({ data: [], error: null }),
          custId ? db.from("jobs").select("id, title, description, invoice_id, lead_id, customer_id").eq("customer_id", custId).limit(2000) : Promise.resolve({ data: [], error: null }),
        ]);
        const viaInv = jq.error ? [] : jq.data || [];
        const direct = directJobsByHouse(houses, dq.error ? [] : dq.data || [], custId);
        const allJobs = [...viaInv, ...Object.values(direct).flat()];
        const jobLeads = [...new Set(allJobs.map((j: { lead_id: string | null }) => j.lead_id).filter(Boolean))] as string[];
        const phq = jobLeads.length ? await db.from("job_photos").select("lead_id").in("lead_id", jobLeads) : { data: [], error: null };
        photos = photosByHouse(inv.data || [], viaInv, phq.error ? [] : phq.data || [], direct);
        // Supplier docs (display only, office only: RLS sjd_ok returns nothing for anyone else).
        const jobIds = [...new Set(Object.values(photos).flatMap((x) => x.jobs.map((j) => j.id)))];
        if (jobIds.length) {
          const lk = await db.from("supplier_job_document_links")
            .select("job_id, status, doc:supplier_job_documents(id, doc_type, doc_number, supplier_name, doc_date, storage_path, suppliers(name))")
            .in("job_id", jobIds).eq("status", "confirmed");
          const rows = (lk.error ? [] : lk.data || []).map((r: { job_id: string | null; status: string; doc: { suppliers?: { name: string } | null } & Record<string, unknown> | null }) =>
            ({ ...r, doc: r.doc ? { ...r.doc, supplier: r.doc.suppliers?.name ?? null } : null }));
          docs = docsByHouse(photos, rows as Parameters<typeof docsByHouse>[1]);
        }
      }
      return { project: p.data as ProjectRow | null, phases: (ph.data || []) as ProjectPhase[], houses, money, photos, docs };
    },
  });
}

export function useInvalidateProject() {
  const qc = useQueryClient();
  return (projectId?: string) => { qc.invalidateQueries({ queryKey: ["project-detail", projectId] }); qc.invalidateQueries({ queryKey: ["projects"] }); };
}

export const clientName = (c?: ProjectRow["customers"]) => c?.company_name || [c?.first_name, c?.last_name].filter(Boolean).join(" ") || "Client";
