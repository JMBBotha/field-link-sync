import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { loadPackingList } from "@/lib/jobPack";
import { checkFromPackAndPlan, type MaterialsPlan } from "@/lib/materialCheckLoad";
import { type CheckKind, type MaterialCheck, type SourceLine } from "@/lib/materialCheck";
import type { PackingRow } from "@/lib/packingList";

type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }> };

async function recordedParts(leadId: string | null | undefined): Promise<SourceLine[]> {
  if (!leadId) return [];
  const { data, error } = await (supabase as unknown as Rpc).rpc("get_job_used_parts", { p_lead_id: leadId });
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
    (supabase as unknown as Rpc).rpc("job_materials_plan", { p_job: jobId }).then((r) => (r.error ? null : r.data as MaterialsPlan | null)).catch(() => null),
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

