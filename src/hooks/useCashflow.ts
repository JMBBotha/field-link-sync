import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { CfData, ProfitData } from "@/lib/cashflow";
import { normalizeCf } from "@/lib/cashflow";

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as any;

/** Owner + admin check for the caller's company (server-side rule _cf_ok). */
export function useCashflowAccess() {
  const company = useQuery({ queryKey: ["caller-company-id"], queryFn: async () => ((await db.rpc("caller_company_id")).data as string | null) ?? null });
  const ok = useQuery({ queryKey: ["cf-ok", company.data], enabled: !!company.data, queryFn: async () => !!(await db.rpc("_cf_ok", { p_company: company.data })).data });
  return { companyId: company.data ?? null, allowed: ok.data, loading: company.isLoading || ok.isLoading };
}

export function useCashflowData(companyId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["cashflow", companyId], enabled: !!companyId && enabled,
    queryFn: async () => {
      const [{ data, error }, s] = await Promise.all([
        db.rpc("cashflow_data", { p_company: companyId }),
        db.from("company_settings").select("default_deposit_percentage").eq("company_id", companyId).limit(1).maybeSingle(),
      ]);
      if (error) throw error;
      return { data: normalizeCf(data), depositPct: Number(s?.data?.default_deposit_percentage ?? 70) || 70 };
    },
  });
}

export function useJobProfit(companyId: string | null, from: string, to: string, enabled: boolean) {
  return useQuery({
    queryKey: ["job-profit", companyId, from, to], enabled: !!companyId && enabled,
    queryFn: async () => { const { data, error } = await db.rpc("job_profit", { p_company: companyId, p_from: from, p_to: to }); if (error) throw error; return data as ProfitData; },
  });
}
