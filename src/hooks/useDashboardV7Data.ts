import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { useAuth } from "@/contexts/AuthContext";
import type { DashData } from "@/lib/dashboardV7";

/** Pages through a select (PostgREST caps at 1000 rows). Existing columns only, RLS applies as usual. */
async function all(build: (from: number, to: number) => any, max = 10000) {
  const out: any[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) return out;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export function useIsCompanyOwner() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["is-my-company-owner", user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    queryFn: async () => { const { data, error } = await (supabase.rpc as any)("is_my_company_owner"); if (error) return false; return data === true; },
  });
}

/** v7 dashboard data: 25 months so every metric has its last-year comparison. */
export function useDashboardV7Data(opts: { office: boolean; owner: boolean }) {
  const { companyId } = useUserCompanyId();
  return useQuery({
    queryKey: ["dashboard-v7", companyId, opts.office, opts.owner],
    enabled: !!companyId,
    refetchInterval: 120_000,
    staleTime: 60_000,
    queryFn: async (): Promise<DashData & { earnings: any[] | null; team: any[]; assignments: any[] }> => {
      const co = companyId as string;
      const since = new Date(Date.now() - 25 * 31 * 86400_000).toISOString();
      const sinceDate = since.slice(0, 10);
      const [leads, quotes, invoices, jobs, commissions, earnings, team, assignments] = await Promise.all([
        all((a, b) => supabase.from("leads").select("id, created_at, first_contact_at, contact_attempts, scheduled_date, status, lead_status").eq("company_id", co).is("deleted_at", null).gte("created_at", since).order("created_at").range(a, b)),
        all((a, b) => supabase.from("quotes").select("id, lead_id, status, sent_at, accepted_at, created_at").eq("company_id", co).gte("created_at", since).order("created_at").range(a, b)),
        opts.office ? all((a, b) => supabase.from("invoices").select("id, status, grand_total, issue_date, paid_date, due_date").eq("company_id", co).or(`issue_date.gte.${sinceDate},status.neq.paid`).order("issue_date").range(a, b)) : Promise.resolve([]),
        all((a, b) => (supabase.from("jobs") as any).select("id, status, scheduled_for, completed_at, awaiting_stock, created_at").eq("company_id", co).gte("created_at", since).order("created_at").range(a, b)),
        opts.owner ? all((a, b) => (supabase.from("sales_commission_snapshots") as any).select("rep_id, commission, earned_at, created_at, status").eq("company_id", co).gte("created_at", since).range(a, b)) : Promise.resolve(null),
        opts.owner ? (supabase.rpc as any)("get_tech_earnings").then((r: any) => (r.error ? null : r.data?.rows || [])) : Promise.resolve(null),
        opts.office ? supabase.from("profiles").select("id, full_name, job_title, dispatch_role, archived_at").eq("company_id", co).is("archived_at", null).limit(200).then((r) => r.data || []) : Promise.resolve([]),
        opts.office ? supabase.from("assignments").select("profile_id, status, jobs!inner(company_id, status)").eq("jobs.company_id", co).in("status", ["proposed", "accepted", "in_progress", "en_route", "on_site"]).limit(2000).then((r: any) => r.data || []) : Promise.resolve([]),
      ]);
      return { leads, quotes, invoices, jobs, commissions, earnings, team, assignments };
    },
  });
}
