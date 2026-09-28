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
          ? (supabase.from("companies") as any).select("labour_cost_per_hour, gp_target_percent, sales_commission_percent").eq("id", companyId).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      return { quote: q.data ?? null, dispatchRole: (p.data?.dispatch_role as string) ?? null, company: c.data ?? null };
    },
  });

  const visible = !!data && canSeeMargin({ userId, roles, dispatchRole: data.dispatchRole, mode, quote: data.quote });
  const co = data?.company;
  const lc = co?.labour_cost_per_hour == null ? null : Number(co.labour_cost_per_hour);
  const settings: MarginSettings = {
    labourCostPerHour: lc != null && lc > 0 ? lc : null,
    gpTargetPercent: co?.gp_target_percent != null ? Number(co.gp_target_percent) : 20,
    commissionPercent: co?.sales_commission_percent != null ? Number(co.sales_commission_percent) : 40,
  };
  return { visible, settings };
}
