// Server-side geocoder via the `geocode-address` edge function.
// No Mapbox token required in the client — the token lives on the server.
import { supabase } from "@/integrations/supabase/client";

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  place_name?: string;
}

export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const term = (address || "").trim();
  if (term.length < 3) return null;
  try {
    const { data, error } = await supabase.functions.invoke("geocode-address", {
      body: { address: term },
    });
    if (error) return null;
    if (!data || data.found === false) return null;
    if (typeof data.latitude !== "number" || typeof data.longitude !== "number") return null;
    return {
      latitude: data.latitude,
      longitude: data.longitude,
      place_name: data.place_name,
    };
  } catch {
    return null;
  }
}
