import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { countAdminHome, inSignedInCompany, type CountFigure } from "@/lib/adminHomeCount";
import { loadPackingList } from "@/lib/jobPack";
import { checkFromPackAndPlan, type MaterialsPlan } from "@/lib/materialCheckLoad";
import { checkKindOf, stockNeedsFromChecks, type CheckKind, type MaterialCheck, type SourceLine } from "@/lib/materialCheck";
import type { PackingRow } from "@/lib/packingList";
import { loadEntries, todayInJohannesburg } from "@/lib/todaysJobs";
import { johannesburgDayBounds, mergeTodayCrew, type TodayJobRow } from "@/lib/todayCrew";
import { useAdminHomeFigures, type AdminHomeSource } from "@/components/v8/AdminHomeFigures";

async function recordedParts(leadId: string | null | undefined): Promise<SourceLine[]> {
  if (!leadId) return [];
  const { data, error } = await (supabase.rpc as any)("get_job_used_parts", { p_lead_id: leadId });
  if (error || !Array.isArray(data)) return [];
  return (data as { id?: string; product_name?: string; product_code?: string; quantity?: number }[])
    .filter((p) => p.product_name)
    .map((p, i) => ({
      id: p.id || `used-${i}`,
      name: p.product_name,
      code: p.product_code || null,
      quantity: Number(p.quantity) || 1,
      source: "recorded" as const,
    }));
}

export async function loadMaterialCheck(jobId: string, kind: CheckKind, quoteHref: string | null, leadId?: string | null): Promise<MaterialCheck> {
  const [pack, planRes, recorded] = await Promise.all([
    loadPackingList(jobId).catch(() => [] as PackingRow[]),
    (supabase.rpc as any)("job_materials_plan", { p_job: jobId }).then((r: { data: MaterialsPlan | null; error: { message?: string } | null }) => (r.error ? null : r.data)).catch(() => null),
    recordedParts(leadId),
  ]);
  return checkFromPackAndPlan(kind, pack || [], planRes, quoteHref, recorded);
}

export function useMaterialCheck(jobId: string | null | undefined, kind: CheckKind, quoteId?: string | null, leadId?: string | null) {
  const href = quoteId ? `/admin/estimates/${quoteId}` : null;
  return useQuery({
    queryKey: ["role-material-check", jobId, kind, quoteId, leadId],
    enabled: !!jobId && kind !== "quote_visit",
    queryFn: () => loadMaterialCheck(jobId as string, kind, href, leadId),
  });
}

function weekEnd(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const weekday = dt.getUTCDay();
  dt.setUTCDate(dt.getUTCDate() + (weekday === 0 ? 1 : 8 - weekday));
  return dt.toISOString().slice(0, 10);
}

export function useAdminRoleData() {
  const { companyId } = useUserCompanyId();
  const figures = useAdminHomeFigures(companyId);
  const today = todayInJohannesburg();
  const crew = useQuery({
    queryKey: ["role-today-crew", companyId, today],
    enabled: !!companyId,
    queryFn: async () => {
      const { start, end } = johannesburgDayBounds(today);
      const entries = await loadEntries({ date: today });
      const entryIds = [...new Set(entries.map((e) => e.job_id).filter(Boolean))] as string[];
      const agentIds = [...new Set(entries.map((e) => e.agent_id).filter(Boolean))] as string[];
      const cols = "id, job_type, title, company_id, status, scheduled_for, started_at, completed_at, address, customers(name)";
      const window = (col: "scheduled_for" | "started_at" | "completed_at") =>
        supabase.from("jobs").select(cols).eq("company_id", companyId as string).gte(col, start).lt(col, end).limit(200);
      const [bySchedule, byStart, byDone, byEntry, peopleRes] = await Promise.all([
        window("scheduled_for"),
        window("started_at"),
        window("completed_at"),
        entryIds.length ? supabase.from("jobs").select(cols).in("id", entryIds) : Promise.resolve({ data: [] as TodayJobRow[], error: null }),
        agentIds.length
          ? supabase.from("profiles").select("id, full_name").in("id", agentIds)
          : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
      ]);
      const failed = bySchedule.error || byStart.error || byDone.error || byEntry.error;
      if (failed) throw failed;
      const names = new Map(((peopleRes.data || []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name || "Technician"]));
      const customerName = (row: { customers?: { name?: string | null } | { name?: string | null }[] | null }) => {
        const c = row.customers;
        return (Array.isArray(c) ? c[0]?.name : c?.name) || null;
      };
      const jobs = [...(bySchedule.data || []), ...(byStart.data || []), ...(byDone.data || []), ...(byEntry.data || [])].map((j) => ({
        id: j.id as string,
        company_id: j.company_id as string | null,
        status: j.status as string | null,
        job_type: j.job_type as string | null,
        title: j.title as string | null,
        scheduled_for: j.scheduled_for as string | null,
        started_at: j.started_at as string | null,
        completed_at: j.completed_at as string | null,
        address: (j as { address?: string | null }).address || null,
        customer_name: customerName(j as { customers?: { name?: string | null } | { name?: string | null }[] | null }),
      }));
      return mergeTodayCrew({
        companyId: companyId as string,
        day: today,
        schedule: entries.filter((e) => e.job_id).map((e) => ({
          jobId: e.job_id as string,
          who: (e.agent_id && names.get(e.agent_id)) || "Unassigned",
          where: e.customer_address,
          client: e.customer_name,
        })),
        jobs,
      });
    },
  });
  const needs = useQuery({
    queryKey: ["role-week-stock", companyId, today],
    enabled: !!companyId,
    queryFn: async () => {
      const end = weekEnd(today);
      const { data, error } = await supabase
        .from("jobs")
        .select("id, title, job_type, status, company_id, quote_id, lead_id, scheduled_for")
        .eq("company_id", companyId as string)
        .gte("scheduled_for", `${today}T00:00:00+02:00`)
        .lt("scheduled_for", `${end}T00:00:00+02:00`)
        .neq("status", "cancelled")
        .limit(12);
      if (error) throw error;
      const rows = ((data || []) as { id: string; title: string | null; job_type: string | null; company_id: string | null; quote_id: string | null; lead_id: string | null }[])
        .filter((j) => inSignedInCompany(j.company_id, companyId));
      const built = await Promise.all(rows.map(async (j) => {
        const kind = checkKindOf({ jobType: j.job_type, title: j.title });
        const href = `/admin/jobs/${j.id}`;
        const quoteHref = j.quote_id ? `/admin/estimates/${j.quote_id}` : href;
        const [pack, planRes, recorded] = await Promise.all([
          loadPackingList(j.id).catch(() => [] as PackingRow[]),
          (supabase.rpc as any)("job_materials_plan", { p_job: j.id }).then((r: { data: MaterialsPlan | null; error: unknown }) => (r.error ? null : r.data)).catch(() => null),
          recordedParts(j.lead_id),
        ]);
        return {
          href,
          kind,
          company_id: j.company_id,
          check: checkFromPackAndPlan(kind, pack || [], planRes, quoteHref, recorded),
        };
      }));
      return stockNeedsFromChecks(companyId as string, built);
    },
  });
  return { companyId, figures, crew, needs, source: figures.source as AdminHomeSource | undefined };
}

export function countsFor(companyId: string | null, source: AdminHomeSource | undefined) {
  if (!companyId || !source) return null;
  return countAdminHome({
    companyId,
    invoices: source.invoices,
    payments: source.payments,
    credits: source.credits,
    jobs: source.jobs,
  });
}

export type { CountFigure };
