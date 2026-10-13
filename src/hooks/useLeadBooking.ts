import { useQuery } from "@tanstack/react-query";
import { fetchLeadBookings, type BookingInfo } from "@/lib/leadBooking";

/** Live "Booked" info for one lead (via its linked open job's assignment + schedule). */
export function useLeadBooking(leadId?: string | null, enabled = true) {
  return useQuery<BookingInfo | null>({
    queryKey: ["lead-booking", leadId],
    enabled: !!leadId && enabled,
    staleTime: 30_000,
    queryFn: async () => (await fetchLeadBookings([leadId!])).get(leadId!) ?? null,
  });
}
