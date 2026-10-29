// Place search for the lead map picker.
// 1. Pasted coordinates or a Google Maps link -> exact pin.
// 2. Mapbox geocoding: South Africa only, all place types, fuzzy, biased to the map centre.
// 3. OpenStreetMap (Nominatim) fallback for farms, rural roads and estates Mapbox lacks.
// 4. Spelling variants (aa/a, jagd/jacht…) when nothing matched.
// Only the typed search term is sent to these services; no client details.

export interface PlaceSuggestion {
  id: string;
  text: string;
  place_name: string;
  center: [number, number]; // [lng, lat]
  source?: "mapbox" | "osm" | "coords";
  /** True for a town/suburb/region centre: centre the map, don't pin it as the property. */
  approximate?: boolean;
}

const DEFAULT_PROXIMITY: [number, number] = [18.96, -33.73]; // Paarl / Cape Winelands

const inZA = (lat: number, lng: number) => lat <= -22 && lat >= -35.5 && lng >= 16 && lng <= 33.5;

/** Parse "-33.74, 19.02", "-33.74 19.02" or a Google/Apple Maps URL holding coordinates. */
export function parseCoordinates(input: string): { lat: number; lng: number } | null {
  let s = (input || "").trim();
  try { s = decodeURIComponent(s); } catch { /* keep raw */ }
  s = s.replace(/\+/g, " ");
  const N = "(-?\\d{1,3}(?:\\.\\d+)?)";
  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, // google place data (most precise)
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/, // google @lat,lng
    /[?&](?:q|query|ll|sll|daddr|destination|center|cbll|viewpoint)=\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/,
    /\/maps\/(?:search|place|dir)\/(?:[^/]*\/)?(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/,
    new RegExp(`^${N}\\s*[,; ]\\s*${N}$`),
    /(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/, // "lat, lng" inside other text
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) {
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        return { lat, lng };
      }
    }
  }
  return null;
}

/** Find a Google Maps link anywhere in pasted text (iPhone share text puts the name first). */
export function extractMapLink(input: string): string | null {
  const m = (input || "").match(/https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.|maps\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)[^\s<>"']*/i);
  return m ? m[0].replace(/[).,;]+$/, "") : null;
}

export const isShortMapLink = (url: string) => /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(url);

/** Place name in a full Google Maps URL (/maps/place/Name/... or ?q=Name). */
export function mapLinkPlaceName(url: string): string | null {
  try {
    const u = new URL(url);
    const p = u.pathname.match(/\/maps\/(?:place|search)\/([^/@]+)/);
    const raw = p?.[1] || u.searchParams.get("q") || u.searchParams.get("query");
    if (!raw) return null;
    const name = decodeURIComponent(raw).replace(/\+/g, " ").trim();
    return name && !parseCoordinates(name) ? name : null;
  } catch {
    return null;
  }
}

/** Follow a maps.app.goo.gl / goo.gl/maps link server-side (allowlisted Google hosts only). */
export async function resolveShortMapLink(url: string): Promise<string | null> {
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data, error } = await supabase.functions.invoke("resolve-map-link", { body: { url } });
    if (error || !data?.url) return null;
    return String(data.url);
  } catch {
    return null;
  }
}

export type MapLinkResult =
  | { kind: "coords"; lat: number; lng: number; name?: string | null }
  | { kind: "name"; name: string }
  | { kind: "failed" };

/** Turn pasted text holding a Google Maps link into coordinates (or a place name to search). */
export async function resolveMapLink(input: string): Promise<MapLinkResult | null> {
  const link = extractMapLink(input);
  if (!link) return null;
  const full = isShortMapLink(link) ? await resolveShortMapLink(link) : link;
  if (!full) return { kind: "failed" };
  const c = parseCoordinates(full);
  const name = mapLinkPlaceName(full);
  if (c) return { kind: "coords", ...c, name };
  if (name) return { kind: "name", name };
  return { kind: "failed" };
}

interface MapboxFeature { id: string; text: string; place_name: string; center: [number, number]; place_type?: string[]; relevance?: number }
interface NominatimRow { osm_type: string; osm_id: number; name?: string; display_name: string; lat: string; lon: string }

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

/** Common Afrikaans/Dutch spelling slips for farm names. */
export function spellingVariants(term: string): string[] {
  const out = new Set<string>();
  const add = (v: string) => { if (v && v !== term) out.add(v); };
  add(term.replace(/aa/gi, "a"));
  add(term.replace(/jagd|jaagd|jagt/gi, "jacht"));
  add(term.replace(/aa/gi, "a").replace(/jagd|jagt/gi, "jacht"));
  add(term.replace(/gd\b/gi, "cht"));
  add(term.replace(/ij/gi, "y"));
  add(term.replace(/y/gi, "ij"));
  add(term.replace(/ou\b/gi, "oud"));
  return [...out].slice(0, 4);
}

async function mapboxSearch(term: string, token: string, proximity: [number, number]): Promise<PlaceSuggestion[]> {
  if (!token) return [];
  const params = new URLSearchParams({
    access_token: token,
    autocomplete: "true",
    fuzzyMatch: "true",
    limit: "8",
    country: "za",
    language: "en",
    proximity: `${proximity[0]},${proximity[1]}`,
  });
  const res = await fetch(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(term)}.json?${params}`,
  );
  if (!res.ok) return [];
  const data = await res.json();
  return ((data.features || []) as MapboxFeature[]).map((f) => ({
    id: `mb:${f.id}`,
    text: f.text,
    place_name: f.place_name,
    center: f.center,
    source: "mapbox" as const,
    approximate: !(f.place_type || []).some((t) => ["address", "poi", "street"].includes(t)),
  }));
}

async function osmSearch(term: string, proximity: [number, number]): Promise<PlaceSuggestion[]> {
  const [lng, lat] = proximity;
  const vb = `${lng - 1.5},${lat + 1.2},${lng + 1.5},${lat - 1.2}`;
  const params = new URLSearchParams({
    format: "jsonv2",
    q: term,
    countrycodes: "za",
    limit: "6",
    addressdetails: "0",
    viewbox: vb,
    "accept-language": "en",
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return ((data || []) as NominatimRow[]).map((r) => ({
    id: `osm:${r.osm_type}${r.osm_id}`,
    text: r.name || String(r.display_name).split(",")[0],
    place_name: String(r.display_name).replace(/, South Africa$/, ""),
    center: [parseFloat(r.lon), parseFloat(r.lat)] as [number, number],
    source: "osm" as const,
  }));
}

/** True when a result actually contains the main word the user typed (not just "Paarl"). */
function hasStrongMatch(list: PlaceSuggestion[], term: string): boolean {
  const words = term.split(/[\s,]+/).map(norm).filter((w) => w.length >= 4);
  if (!words.length) return list.length > 0;
  return list.some((s) => {
    const name = norm(`${s.text} ${s.place_name}`);
    return words.every((w) => name.includes(w));
  });
}

function dedupe(list: PlaceSuggestion[]): PlaceSuggestion[] {
  const seen = new Set<string>();
  return list.filter((s) => {
    const k = `${norm(s.text)}|${s.center[0].toFixed(3)}|${s.center[1].toFixed(3)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const km = (a: [number, number], b: [number, number]) => {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

export async function searchPlaces(
  term: string,
  token: string,
  proximity?: [number, number],
): Promise<PlaceSuggestion[]> {
  const q = term.trim();
  if (q.length < 2) return [];

  const link = extractMapLink(q);
  if (link) {
    const r = await resolveMapLink(q);
    if (r?.kind === "coords") {
      return [{
        id: `coords:${r.lat},${r.lng}`,
        text: r.name || `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`,
        place_name: `Google Maps pin · ${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`,
        center: [r.lng, r.lat],
        source: "coords",
      }];
    }
    if (r?.kind === "name") return searchPlaces(r.name, token, proximity);
    return [];
  }

  const coords = parseCoordinates(q);
  if (coords) {
    return [{
      id: `coords:${coords.lat},${coords.lng}`,
      text: `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`,
      place_name: "Drop pin at these coordinates",
      center: [coords.lng, coords.lat],
      source: "coords",
    }];
  }

  const prox =
    proximity && inZA(proximity[1], proximity[0]) ? proximity : DEFAULT_PROXIMITY;

  const NEAR_KM = 200;
  const near = (l: PlaceSuggestion[]) => l.filter((x) => km(x.center, prox) <= NEAR_KM);
  const strongNear = (l: PlaceSuggestion[], t: string) => hasStrongMatch(near(l), t);
  const safe = async (p: Promise<PlaceSuggestion[]>) => { try { return await p; } catch { return []; } };

  let results = await safe(mapboxSearch(q, token, prox));
  if (q.length >= 4 && !strongNear(results, q)) {
    const osm = await safe(osmSearch(q, prox));
    results = [...osm.filter((s) => hasStrongMatch([s], q)), ...results, ...osm.filter((s) => !hasStrongMatch([s], q))];
  }
  if (q.length >= 5 && !hasStrongMatch(results, q)) {
    for (const v of spellingVariants(q)) {
      const alt = [...(await safe(mapboxSearch(v, token, prox)))];
      const strong = alt.filter((s) => hasStrongMatch([s], v));
      if (strong.length) { results = [...strong, ...results]; break; }
      const osm = await safe(osmSearch(v, prox));
      const ostrong = osm.filter((s) => hasStrongMatch([s], v));
      if (ostrong.length) { results = [...ostrong, ...results]; break; }
    }
  }
  // Best first: exact-word matches near the work area, then other matches, then the rest.
  const score = (x: PlaceSuggestion) =>
    (hasStrongMatch([x], q) ? 0 : 2) + (km(x.center, prox) <= NEAR_KM ? 0 : 1);
  return dedupe(results)
    .map((x, i) => ({ x, i }))
    .sort((a, b) => score(a.x) - score(b.x) || a.i - b.i)
    .map(({ x }) => x)
    .slice(0, 8);
}

