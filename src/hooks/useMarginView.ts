import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { jsonNumber, jsonObject, jsonString } from "@/lib/jsonValue";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/hooks/useRole";
import { canSeeMargin } from "@/lib/marginAccess";
import type { MarginSettings } from "@/lib/margin";

/** One component of the tech's labour share (Job 6): paid on completion, or holdback released after hold_days. */
export type TechPart = { kind: string; label?: string; percent: number; hold_days?: number };

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
        supabase.from("quotes").select("sales_engineer_id, created_by, owner_id").eq("id", quoteId).maybeSingle(),
        supabase.from("profiles").select("dispatch_role").eq("id", userId).maybeSingle(),
        companyId
          ? supabase.rpc("get_company_margin_settings", { p_company_id: companyId })
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
      const { data: e, error } = await supabase.rpc("get_my_earnings", { p_quote_id: quoteId });
      if (error) return null;
      const body = jsonObject(e);
      const first = Array.isArray(body?.quotes) ? body.quotes[0] : null;
      const quote = jsonObject(first ?? null);
      if (!quote) return null;
      const viewer = jsonObject(quote.viewer);
      const sales = jsonObject(quote.sales);
      const tech = jsonObject(quote.tech);
      const rule = jsonObject(tech?.rule);
      const parts = Array.isArray(rule?.parts) ? rule.parts.flatMap((item): TechPart[] => {
        const part = jsonObject(item);
        const percent = jsonNumber(part?.percent);
        if (!part || typeof part.kind !== "string" || percent == null) return [];
        return [{ kind: part.kind, label: jsonString(part.label) ?? undefined, percent, hold_days: jsonNumber(part.hold_days) ?? undefined }];
      }) : [];
      return {
        viewer: viewer ? { is_owner: viewer.is_owner === true } : undefined,
        sales: sales ? { percent: jsonNumber(sales.percent) ?? undefined, gp_target_percent: jsonNumber(sales.gp_target_percent) ?? undefined } : undefined,
        tech: tech ? { percent: jsonNumber(tech.percent) ?? undefined, rule: rule ? { parts, tools_percent: jsonNumber(rule.tools_percent) ?? undefined } : undefined } : undefined,
      };
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
  const owner = !!earn?.viewer?.is_owner;
  const splits = {
    sales: earn?.sales?.percent != null,
    owner,
    // Owner only: tech paid / held parts and the tools share the company keeps (all % of labour sell ex VAT).
    techParts: owner ? (earn?.tech?.rule?.parts ?? []).map((p) => ({ ...p, percent: Number(p.percent) || 0 })) : [],
    toolsPercent: owner ? Number(earn?.tech?.rule?.tools_percent) || 0 : 0,
  };
  return { visible, settings, splits };
}
