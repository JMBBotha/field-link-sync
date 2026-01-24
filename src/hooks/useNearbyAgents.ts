import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface NearbyAgent {
  agent_id: string;
  full_name: string;
  distance_km: number;
  is_available: boolean;
}

export const useNearbyAgents = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const findNearbyAgents = useCallback(
    async (
      latitude: number,
      longitude: number,
      radiusKm: number
    ): Promise<NearbyAgent[]> => {
      setLoading(true);
      setError(null);

      try {
        const { data, error: rpcError } = await supabase.rpc("get_agents_within_radius", {
          lead_lat: latitude,
          lead_lng: longitude,
          radius_km: radiusKm,
        });

        if (rpcError) throw rpcError;

        return (data || []).map((agent: any) => ({
          agent_id: agent.agent_id,
          full_name: agent.full_name || "Unknown Agent",
          distance_km: agent.distance_km,
          is_available: agent.is_available,
        }));
      } catch (err: any) {
        console.error("Error finding nearby agents:", err);
        setError(err.message);
        return [];
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return {
    findNearbyAgents,
    loading,
    error,
  };
};
