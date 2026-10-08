import { useQuery } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/useRole";
import { todayInJohannesburg } from "@/lib/todaysJobs";

/** Overlapping bookings for today..+30 days (office only; techs never see it). */
export function useDoubleBookings() {
  const { canAccessAdmin, userId } = useRole();
  const q = useQuery({
    queryKey: ["double-bookings", userId],
    enabled: !!userId && canAccessAdmin,
    refetchInterval: 60_000,
    queryFn: async () => {
      const from = todayInJohannesburg();
      const to = format(addDays(new Date(`${from}T12:00:00`), 30), "yyyy-MM-dd");
      const { data, error } = await (supabase.rpc as any)("open_double_bookings", { p_from: from, p_to: to });
      if (error) { console.warn("[double-bookings]", error.message); return []; }
      return (data || []) as any[];
    },
  });
  return { count: canAccessAdmin ? (q.data?.length ?? 0) : 0, rows: q.data ?? [] };
}
