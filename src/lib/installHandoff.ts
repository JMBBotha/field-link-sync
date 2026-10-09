/** P3 hand to technician: pure helpers (no money anywhere in here). */
export type HandoffRole = "ops" | "rep";
export type HandoffMode = "pick" | "offer";

export interface HandoffStatus {
  role: HandoffRole;
  default_mode: "manual" | "auto";
  job_id: string | null;
  technician: string | null;
  pending: number;
  round: number | null;
  unclaimed: boolean;
}

export interface InstallOffer {
  offer_id: string;
  job_id: string;
  client: string;
  suburb: string | null;
  date: string;
  start: string;
  minutes: number | null;
  distance_km: number | null;
  respond_by: string;
}

/** Salespeople can only offer (never name a technician); office can pick or offer. */
export const handoffModesFor = (role: HandoffRole | null | undefined): HandoffMode[] =>
  role === "rep" ? ["offer"] : ["pick", "offer"];

export const defaultModeFor = (role: HandoffRole | null | undefined, companyDefault?: string | null): HandoffMode =>
  role === "rep" ? "offer" : companyDefault === "auto" ? "offer" : "pick";

export const durationLabel = (minutes: number | null | undefined): string => {
  const m = Number(minutes) || 0;
  if (m >= 960) return "2 days";
  if (m >= 480) return "Full day";
  if (m % 60 === 0) return `${m / 60} h`;
  return `${Math.round((m / 60) * 10) / 10} h`;
};

export const countdown = (respondBy: string, now: number = Date.now()): string => {
  const s = Math.max(0, Math.floor((new Date(respondBy).getTime() - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** One-line summary for an install offer card. Deliberately has no price/total field. */
export const offerSummary = (o: InstallOffer): string => {
  const d = new Date(`${o.date}T00:00:00`);
  const day = d.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });
  return [o.suburb, `${day} ${o.start}`, durationLabel(o.minutes), o.distance_km != null ? `${o.distance_km} km away` : null]
    .filter(Boolean)
    .join(" · ");
};

/** Status line for the hand-off step. */
export const handoffStatusText = (s: HandoffStatus | null | undefined): string | null => {
  if (!s?.job_id) return null;
  if (s.technician) return `Handed to ${s.technician}`;
  if (s.pending > 0) return `Offered to ${s.pending} technician${s.pending === 1 ? "" : "s"} — waiting for someone to accept`;
  if (s.unclaimed) return s.role === "rep" ? "No technician took it — the office has been asked to pick one" : "No technician took it — pick one";
  return null;
};
