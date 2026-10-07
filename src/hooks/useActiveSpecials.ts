import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { pickActiveSpecial, todayIso, type SupplierSpecial } from "@/lib/specials";

/** Today's running specials (empty for technicians: RLS returns nothing). */
export function useActiveSpecials() {
  const today = todayIso();
  const { data = [] } = useQuery({
    queryKey: ["active-specials", today],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_specials" as any) as any)
        .select("*").eq("is_active", true).lte("start_date", today).gte("end_date", today);
      if (error) return [] as SupplierSpecial[];
      return (data ?? []) as SupplierSpecial[];
    },
  });
  const find = useCallback(
    (productId?: string | null, modelNumber?: string | null) => pickActiveSpecial(data, { productId, modelNumber }, today),
    [data, today],
  );
  return { specials: data, find };
}
