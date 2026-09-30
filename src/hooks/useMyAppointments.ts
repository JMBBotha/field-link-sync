import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/useRole";
import { sortAppointments, type MyAppointment } from "@/lib/appointments";

/** Caller's own upcoming appointments + unassigned-available ones (server-scoped by get_my_appointments). */
export function useMyAppointments(days = 60, enabled = true) {
  const { userId } = useRole();
  return useQuery({
    queryKey: ["my-appointments", userId, days],
    enabled: enabled && !!userId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_my_appointments", { p_days: days });
      if (error) throw error;
      return sortAppointments((data ?? []) as MyAppointment[]);
    },
  });
}
