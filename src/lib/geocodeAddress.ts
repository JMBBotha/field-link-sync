// Lightweight Mapbox forward-geocoder that reuses the token stored by LocationPicker.
export interface GeocodeResult {
  latitude: number;
  longitude: number;
  place_name?: string;
}

export const getMapboxToken = (): string =>
  (typeof window !== "undefined" && localStorage.getItem("mapbox_token")) || "";

export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const token = getMapboxToken();
  const term = (address || "").trim();
  if (!token || term.length < 3) return null;
  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
      term
    )}.json?access_token=${token}&limit=1&country=za`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const feat = data?.features?.[0];
    if (!feat?.center) return null;
    const [lng, lat] = feat.center as [number, number];
    return { latitude: lat, longitude: lng, place_name: feat.place_name };
  } catch {
    return null;
  }
}
