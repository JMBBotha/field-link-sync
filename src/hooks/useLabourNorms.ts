import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { LabourNorm } from "@/lib/pricingChecks";

export interface LabourNormRow extends LabourNorm { id: string; sort_order: number }

export function useLabourNorms() {
  return useQuery({
    queryKey: ["labour-norms"],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("labour_norms" as any) as any).select("id, key, label, hours, sort_order").order("sort_order");
      if (error) throw error;
      return ((data || []) as any[]).map((r) => ({ ...r, hours: Number(r.hours) })) as LabourNormRow[];
    },
  });
}
