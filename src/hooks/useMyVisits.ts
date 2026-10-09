import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { VisitRow } from "@/lib/visits";

export function useMyVisits(days = 60) {
  return useQuery({
    queryKey: ["my-visits", days],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("get_my_visits", { p_days: days });
      if (error) throw error;
      return (data ?? []) as VisitRow[];
    },
  });
}
