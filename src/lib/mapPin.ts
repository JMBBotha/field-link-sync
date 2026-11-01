/** Map pin helpers (Johan t2045u): exact pin beats typed address. */
export type LatLng = { lat: number; lng: number };

const valid = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

/** Coordinates found in free text: "(-34.0102159, 18.4063251)", "@-34.01,18.40", "q=-34.01,18.40". */
export function coordsFromText(text?: string | null): LatLng | null {
  if (!text) return null;
  const m = /(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/.exec(text);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  return valid(lat, lng) ? { lat, lng } : null;
}

export function storedPin(lat?: number | string | null, lng?: number | string | null): LatLng | null {
  if (lat == null || lng == null || lat === "" || lng === "") return null;
  const a = Number(lat), b = Number(lng);
  return valid(a, b) ? { lat: a, lng: b } : null;
}

/** Map link: stored pin, else coordinates in the notes, else the typed address. */
export function mapHref(opts: { lat?: number | string | null; lng?: number | string | null; notes?: string | null; address?: string | null }): string | null {
  const p = storedPin(opts.lat, opts.lng) || coordsFromText(opts.notes);
  if (p) return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
  return opts.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(opts.address)}` : null;
}

/** Split text into plain and URL parts for tappable links. */
export function linkParts(text: string): { t: string; url?: string }[] {
  const out: { t: string; url?: string }[] = [];
  const re = /https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ t: text.slice(last, m.index) });
    out.push({ t: m[0], url: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last) });
  return out;
}
