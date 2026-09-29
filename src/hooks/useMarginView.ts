import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/hooks/useRole";
import { canSeeMargin } from "@/lib/marginAccess";
import type { MarginSettings } from "@/lib/margin";

/** Visibility + company margin settings for the open quote (staff only). */
export function useMarginView(quoteId: string | null, companyId: string | null, mode: "admin" | "agent" = "admin") {
  const { user } = useAuth();
  const { roles } = useRole();
  const userId = user?.id ?? null;

  const { data } = useQuery({
    queryKey: ["margin-view", quoteId, companyId, userId],
    enabled: !!quoteId && !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const [q, p, c] = await Promise.all([
        (supabase.from("quotes") as any).select("sales_engineer_id, created_by, owner_id").eq("id", quoteId).maybeSingle(),
        (supabase.from("profiles") as any).select("dispatch_role").eq("id", userId).maybeSingle(),
        companyId
          ? (supabase.rpc as any)("get_company_margin_settings", { p_company_id: companyId })
          : Promise.resolve({ data: null }),
      ]);
      return { quote: q.data ?? null, dispatchRole: (p.data?.dispatch_role as string) ?? null, company: (Array.isArray(c.data) ? c.data[0] : c.data) ?? null };
    },
  });

  // Splits come from the server (get_my_earnings): own sales figures for the quote's rep, everything for the company owner only.
  const { data: earn } = useQuery({
    queryKey: ["my-earnings", quoteId, userId],
    enabled: !!quoteId && !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: e, error } = await (supabase.rpc as any)("get_my_earnings", { p_quote_id: quoteId });
      if (error) return null;
      return (e?.quotes?.[0] ?? null) as { viewer?: { is_owner?: boolean }; sales?: { percent?: number; gp_target_percent?: number }; tech?: { percent?: number } } | null;
    },
  });

  const visible = !!data && canSeeMargin({ userId, roles, dispatchRole: data.dispatchRole, mode, quote: data.quote });
  const co = data?.company;
  const lc = co?.labour_cost_per_hour == null ? null : Number(co.labour_cost_per_hour);
  const settings: MarginSettings = {
    labourCostPerHour: lc != null && lc > 0 ? lc : null,
    gpTargetPercent: co?.gp_target_percent != null ? Number(co.gp_target_percent) : earn?.sales?.gp_target_percent != null ? Number(earn.sales.gp_target_percent) : 20,
    salesSharePercent: earn?.sales?.percent != null ? Number(earn.sales.percent) : 0,
    labourTechSharePercent: earn?.tech?.percent != null && earn?.viewer?.is_owner ? Number(earn.tech.percent) : 0,
  };
  const splits = { sales: earn?.sales?.percent != null, owner: !!earn?.viewer?.is_owner };
  return { visible, settings, splits };
}
