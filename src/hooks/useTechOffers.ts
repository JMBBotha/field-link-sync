import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { techOffersFromJson, type TechOffersResult } from "@/lib/leadOffers";

/** Server-side fit of available service leads for the signed-in tech (hours, bookings, blocked time, travel, 15 km). */
export function useTechOffers(enabled = true) {
  return useQuery({
    queryKey: ["tech-offers"],
    enabled,
    refetchInterval: 60_000,
    staleTime: 30_000,
    queryFn: async (): Promise<TechOffersResult | null> => {
      const { data, error } = await supabase.rpc("tech_offers");
      if (error) { console.warn("tech_offers failed, showing unfiltered list", error.message); return null; }
      return techOffersFromJson(data);
    },
  });
}
