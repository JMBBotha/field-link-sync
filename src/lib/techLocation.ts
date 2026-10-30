// Pure helpers for the job's live tech location block (tested in src/test/techLocation.test.ts).
export type TechLoc = {
  tech_id: string; name: string; lat: number | null; lng: number | null;
  last_updated: string | null; distance_km: number | null;
  status: "on_site" | "on_the_way" | "not_started"; shared: boolean;
};
export type JobTechLocation = {
  allowed: boolean; in_window?: boolean; window_start?: string | null; window_end?: string | null;
  scheduled_start?: string | null; job_lat?: number | null; job_lng?: number | null; techs?: TechLoc[];
};

export const STATUS_LABEL: Record<string, string> = {
  on_site: "On site", on_the_way: "On the way", not_started: "Not started",
};

export function techStatusLabel(t: TechLoc): string {
  if (!t.shared) return "Location not shared";
  return STATUS_LABEL[t.status] || "Not started";
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
