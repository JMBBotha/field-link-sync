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
