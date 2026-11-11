import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { bookingTechnicians, EXCLUDED_TECH_COMPANY_IDS, type BookingTechRow } from "@/lib/bookingTechnicians";
import { useMyBookableTechnicianIds } from "@/hooks/useMyBookableTechnicianIds";

/** Company technicians for logging or booking a visit. Same people as the dispatch lane, including offline techs. Sales sees only the technicians an admin assigned. */
export function useBookingTechnicians(companyId: string | null | undefined, enabled = true) {
  const blocked = !companyId || (EXCLUDED_TECH_COMPANY_IDS as readonly string[]).includes(companyId);
  const scope = useMyBookableTechnicianIds();
  return useQuery({
    queryKey: ["booking-technicians", companyId, scope.isSalesRep, scope.failed, scope.ids],
    enabled: enabled && !blocked && !scope.loading,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, company_id, dispatch_role, participant_type, dispatch_active, archived_at")
        .eq("company_id", companyId!)
        .eq("dispatch_active", true)
        .is("archived_at", null);
      if (error) throw error;
      return bookingTechnicians(
        (data || []) as BookingTechRow[],
        companyId,
        scope.isSalesRep ? { salesRep: true, assignedIds: scope.failed ? [] : scope.ids } : undefined,
      );
    },
  });
}
