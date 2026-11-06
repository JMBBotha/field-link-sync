// Pure helpers for the job's live tech location block (tested in src/test/techLocation.test.ts).
export type TechLoc = {
  tech_id: string; name: string; lat: number | null; lng: number | null;
  last_updated: string | null; distance_km: number | null;
  status: "on_site" | "on_the_way" | "not_started" | "left_site"; shared: boolean;
  arrived_at?: string | null; left_at?: string | null; en_route_at?: string | null;
};
export type JobTechLocation = {
  allowed: boolean; in_window?: boolean; window_start?: string | null; window_end?: string | null;
  scheduled_start?: string | null; job_lat?: number | null; job_lng?: number | null; techs?: TechLoc[];
};

const STATUSES = new Set(["on_site", "on_the_way", "not_started", "left_site"]);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** job_tech_location returns jsonb. Drop anything that is not that shape. */
export function parseJobTechLocation(data: unknown): JobTechLocation | null {
  let value = data;
  if (typeof value === "string") {
    try { value = JSON.parse(value) as unknown; } catch { return null; }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.allowed !== "boolean") return null;
  if (!row.allowed) return { allowed: false };
  const techs = Array.isArray(row.techs) ? row.techs.flatMap((item): TechLoc[] => {
    if (!item || typeof item !== "object") return [];
    const t = item as Record<string, unknown>;
    const status = typeof t.status === "string" && STATUSES.has(t.status) ? t.status as TechLoc["status"] : "not_started";
    if (typeof t.tech_id !== "string" || typeof t.name !== "string") return [];
    return [{
      tech_id: t.tech_id, name: t.name, lat: num(t.lat), lng: num(t.lng),
      last_updated: str(t.last_updated), distance_km: num(t.distance_km),
      status, shared: t.shared === true,
      arrived_at: str(t.arrived_at), left_at: str(t.left_at), en_route_at: str(t.en_route_at),
    }];
  }) : [];
  return {
    allowed: true,
    in_window: row.in_window === true,
    window_start: str(row.window_start),
    window_end: str(row.window_end),
    scheduled_start: str(row.scheduled_start),
    job_lat: num(row.job_lat),
    job_lng: num(row.job_lng),
    techs,
  };
}

export const STATUS_LABEL: Record<string, string> = {
  on_site: "On site", on_the_way: "On the way", not_started: "Not started", left_site: "Left site",
};

export function techStatusLabel(t: TechLoc): string {
  if (t.status === "left_site" || t.arrived_at) return STATUS_LABEL[t.status] || "On site";
  if (t.status === "not_started") return "Not started";
  if (!t.shared) return "Location not shared";
  return STATUS_LABEL[t.status] || "Not started";
}

/** A pin is only drawn from a real shared coordinate. Never a guessed position. */
export function showTechPin(t: Pick<TechLoc, "shared" | "lat" | "lng">): boolean {
  return !!(t.shared && t.lat != null && t.lng != null);
}

/** Honest sentence for one technician. No location is invented. */
export function wayDetail(t: TechLoc): string {
  if (t.status === "not_started") return `${t.name} has not started the trip.`;
  if (t.status === "left_site") return showTechPin(t) ? `${t.name} has left the site.` : `${t.name} has left the site. Location is not being shared.`;
  if (!showTechPin(t)) {
    if (t.status === "on_the_way") return `${t.name} is on the way, but is not sharing location. No pin to show.`;
    if (t.status === "on_site") return `${t.name} is on site, but is not sharing location. No pin to show.`;
    return `${t.name} is not sharing location. No pin to show.`;
  }
  if (t.status === "on_the_way") return `${t.name} is on the way.`;
  if (t.status === "on_site") return `${t.name} is on site.`;
  return t.name;
}

export const WAY_LATER = "On-the-way map opens 90 minutes before the visit. The technician's location is not shown yet.";

/** Project the technician (and the job, when it has coordinates) into a small map box. */
export function wayPinLayout(
  tech: { lat: number; lng: number },
  jobLat?: number | null,
  jobLng?: number | null,
  box = { w: 320, h: 150, pad: 18 },
): { tech: { x: number; y: number }; job: { x: number; y: number } | null } {
  const pts = [{ lat: tech.lat, lng: tech.lng }];
  const hasJob = jobLat != null && jobLng != null;
  if (hasJob) pts.push({ lat: jobLat as number, lng: jobLng as number });
  let minLat = Math.min(...pts.map((p) => p.lat));
  let maxLat = Math.max(...pts.map((p) => p.lat));
  let minLng = Math.min(...pts.map((p) => p.lng));
  let maxLng = Math.max(...pts.map((p) => p.lng));
  if (maxLat - minLat < 0.01) { minLat -= 0.01; maxLat += 0.01; }
  if (maxLng - minLng < 0.01) { minLng -= 0.01; maxLng += 0.01; }
  const xOf = (lng: number) => box.pad + ((lng - minLng) / (maxLng - minLng)) * (box.w - box.pad * 2);
  const yOf = (lat: number) => box.pad + ((maxLat - lat) / (maxLat - minLat)) * (box.h - box.pad * 2);
  return {
    tech: { x: xOf(tech.lng), y: yOf(tech.lat) },
    job: hasJob ? { x: xOf(jobLng as number), y: yOf(jobLat as number) } : null,
  };
}

export function friendlyAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const mins = Math.round((now - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return `${h} h ${mins % 60} min ago`;
}

export function sastTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Johannesburg" }).format(new Date(iso));
}

// Rough drive ETA: 40 km/h average in town, rounded to 5 min.
export function etaMinutes(km: number | null | undefined): number | null {
  if (km == null) return null;
  return Math.max(5, Math.round((km / 40) * 60 / 5) * 5);
}

export function mapUrl(t: TechLoc, jobLat?: number | null, jobLng?: number | null): string | null {
  if (t.lat == null || t.lng == null) return null;
  if (jobLat != null && jobLng != null)
    return `https://www.google.com/maps/dir/?api=1&origin=${t.lat},${t.lng}&destination=${jobLat},${jobLng}`;
  return `https://www.google.com/maps/search/?api=1&query=${t.lat},${t.lng}`;
}

export type PresenceTarget = {
  id?: string; target?: string; kind: "job" | "sales_visit"; title: string | null; distance_m: number | null;
  en_route_at?: string | null; arrived_at?: string | null; left_at?: string | null; window_end?: string | null;
  en_route_source?: string | null; nudge?: boolean;
};
export const CANCEL_TRIP_MS = 5 * 60_000;
export function canCancelTrip(t: PresenceTarget, now = Date.now()): boolean {
  return !!t.en_route_at && !t.arrived_at && now - new Date(t.en_route_at).getTime() < CANCEL_TRIP_MS;
}
export function presenceLabel(t: PresenceTarget): string {
  if (t.left_at) return `Checked out ${sastTime(t.left_at)}`;
  if (t.arrived_at) return `Checked in ${sastTime(t.arrived_at)}`;
  if (t.en_route_at) return "On the way";
  return "Not started";
}
