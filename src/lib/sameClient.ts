/** Same-client duplicate bookings (12 Oct). DB: client_open_bookings, lead_duplicate_flags, resolve_duplicate_lead. */
export interface ClientBooking {
  lead_id: string;
  customer_name: string | null;
  status: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  tech_id: string | null;
  tech_name: string | null;
  booked: boolean;
  match: "strong" | "soft" | string;
}
export interface DupFlag {
  lead_id: string;
  other_lead_id: string;
  other_status: string | null;
  other_date: string | null;
  other_time: string | null;
  other_tech: string | null;
  other_booked: boolean;
  match: "strong" | "soft" | string;
  n_others: number;
}
export type DupAction = "merge" | "cancel" | "keep_both";

/** Best existing booking to show/replace: booked strong first, then strong, then soft. */
export function pickPrimary(rows: ClientBooking[] | null | undefined): ClientBooking | null {
  const list = rows ?? [];
  const score = (r: ClientBooking) => (r.match === "strong" ? 2 : 0) + (r.booked ? 1 : 0);
  return [...list].sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** "Tue 13 Oct 10:00" | "no date yet" */
export function whenText(date: string | null | undefined, time: string | null | undefined): string {
  if (!date) return "no date yet";
  const d = new Date(`${date}T00:00:00`);
  const day = d.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });
  return time ? `${day} ${time.slice(0, 5)}` : day;
}

/** Dialog headline: "This client already has a booking on Tue 13 Oct 10:00 with Thabo Mokoena" */
export function dupHeadline(b: Pick<ClientBooking, "booked" | "match" | "scheduled_date" | "scheduled_time" | "tech_name">): string {
  const who = b.tech_name ? ` with ${b.tech_name}` : "";
  if (b.match !== "strong") return `This may be the same client (same address, similar name): open lead on ${whenText(b.scheduled_date, b.scheduled_time)}${who}`;
  return b.booked
    ? `This client already has a booking on ${whenText(b.scheduled_date, b.scheduled_time)}${who}`
    : `This client already has an open lead (${whenText(b.scheduled_date, b.scheduled_time)}${who})`;
}

/** One flag per lead (the most important other lead). */
export function flagsByLead(rows: DupFlag[] | null | undefined): Map<string, DupFlag> {
  const m = new Map<string, DupFlag>();
  const score = (r: DupFlag) => (r.match === "strong" ? 2 : 0) + (r.other_booked ? 1 : 0);
  for (const r of rows ?? []) {
    const cur = m.get(r.lead_id);
    if (!cur || score(r) > score(cur)) m.set(r.lead_id, r);
  }
  return m;
}

export const ACTION_LABEL: Record<DupAction, string> = {
  merge: "Merge into the other booking",
  cancel: "Cancel this one",
  keep_both: "Keep both (second visit)",
};
