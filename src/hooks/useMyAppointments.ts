import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/useRole";
import { sortAppointments, type MyAppointment } from "@/lib/appointments";
import { mergeOffers, type LeadOffer, type WithOffer } from "@/lib/leadOffers";

/** Caller's own upcoming appointments + unassigned-available ones (server-scoped by get_my_appointments). */
export function useMyAppointments(days = 60, enabled = true) {
  const { userId } = useRole();
  return useQuery({
    queryKey: ["my-appointments", userId, days],
    enabled: enabled && !!userId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_my_appointments", { p_days: days });
      if (error) throw error;
      const rows = sortAppointments((data ?? []) as MyAppointment[]);
      if (!rows.some((r) => !r.is_mine)) return rows as WithOffer<MyAppointment>[];
      // Available leads: km + "near your 14:00 job / near home / near office", nearest first (empty for non-reps).
      const { data: offers } = await (supabase.rpc as any)("rep_offerable_leads");
      return mergeOffers(rows, (offers ?? []) as LeadOffer[]);
    },
  });
}
