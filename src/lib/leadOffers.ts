/** Lead filtering (9 Oct): reps are only offered unassigned leads whose slot fits their day (DB: rep_offerable_leads). */
export interface LeadOffer { lead_id: string; km: number | null; label: string | null }
export interface LeadOfferFlag {
  lead_id: string | null;
  customer_name: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  issue: "needs_time" | "no_location" | "no_rep_fits" | "rep_no_base" | string;
  detail: string | null;
}

export type WithOffer<T> = T & { offer_km?: number | null; offer_label?: string | null };

/** Own rows keep their order; available rows get km + label and follow, nearest first. */
export function mergeOffers<T extends { lead_id: string; is_mine: boolean }>(rows: T[], offers: LeadOffer[] | null | undefined): WithOffer<T>[] {
  const byId = new Map((offers ?? []).map((o) => [o.lead_id, o]));
  const mine = rows.filter((r) => r.is_mine);
  const avail = rows
    .filter((r) => !r.is_mine)
    .map((r) => ({ ...r, offer_km: byId.get(r.lead_id)?.km ?? null, offer_label: byId.get(r.lead_id)?.label ?? null }))
    .sort((a, b) => (a.offer_km ?? Number.POSITIVE_INFINITY) - (b.offer_km ?? Number.POSITIVE_INFINITY));
  return [...mine, ...avail];
}

/** "3.3 km · near home" */
export function offerText(km: number | null | undefined, label: string | null | undefined): string {
  const parts = [km != null ? `${Number(km).toFixed(1)} km` : null, label || null].filter(Boolean);
  return parts.join(" · ");
}

export const FLAG_LABEL: Record<string, string> = {
  needs_time: "Needs appointment time",
  no_location: "No location",
  no_rep_fits: "No salesperson free nearby",
  rep_no_base: "No base set",
};

/** Tech offers (9 Oct): service leads that fit the tech's day incl. travel (DB: tech_offers). */
export interface TechOffer {
  lead_id: string;
  fits: boolean;
  km: number | null;
  label: string | null;
  reason: string | null;
  slot_date: string | null;
  slot_start: string | null;
  minutes: number | null;
  minutes_source: "booking" | "quote" | "estimate" | string | null;
}
export interface TechOffersResult { applies: boolean; offers: TechOffer[] }

/** "≈ 3.5 h", "≈ 2 h", "≈ 45 min" */
export function durationText(minutes: number | null | undefined): string {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m <= 0) return "";
  if (m < 60) return `≈ ${Math.round(m)} min`;
  const h = Math.round((m / 60) * 2) / 2;
  return `≈ ${Number.isInteger(h) ? h : h.toFixed(1)} h`;
}

/** "Fits Mon 12:05" for unbooked offers (slot_date yyyy-mm-dd, slot_start HH:MM[:SS]). */
export function slotText(date: string | null | undefined, start: string | null | undefined, today = new Date()): string {
  if (!date || !start) return "";
  const d = new Date(`${date}T00:00:00`);
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((d.getTime() - t0.getTime()) / 86400000);
  const day = diff === 0 ? "today" : diff === 1 ? "tomorrow" : d.toLocaleDateString("en-ZA", { weekday: "short" });
  return `Fits ${day} ${start.slice(0, 5)}`;
}

/** Keep only offered leads, nearest first; when the server filter doesn't apply, return the list unchanged. */
export function applyTechOffers<T extends { id: string }>(leads: T[], result: TechOffersResult | null | undefined): (T & { techOffer?: TechOffer })[] {
  if (!result?.applies) return leads;
  const byId = new Map(result.offers.filter((o) => o.fits).map((o) => [o.lead_id, o]));
  return leads
    .filter((l) => byId.has(l.id))
    .map((l) => ({ ...l, techOffer: byId.get(l.id) }))
    .sort((a, b) => (a.techOffer?.km ?? Number.POSITIVE_INFINITY) - (b.techOffer?.km ?? Number.POSITIVE_INFINITY));
}
