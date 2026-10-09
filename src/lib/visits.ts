/** P1 "My visits" (sales reps): row shape from get_my_visits and pure tab filtering. */
export interface VisitRow {
  lead_id: string;
  customer_id: string | null;
  customer_name: string | null;
  phone: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  status: string | null;
  primary_intent: string | null;
  is_mine: boolean;
  notes: string | null;
  quote_id: string | null;
  quote_number: string | null;
  quote_status: string | null;
  quote_total: number | null;
  quote_accepted: boolean;
  has_install_job: boolean;
  offer_km?: number | null;
  offer_label?: string | null;
}

export type VisitTab = "available" | "upcoming" | "handover" | "done";

const CLOSED = new Set(["completed", "converted", "cancelled"]);

export function visitTab(r: VisitRow): VisitTab | null {
  if (!r.is_mine) return r.status === "pending" ? "available" : null;
  if (r.quote_accepted && !r.has_install_job) return "handover";
  if (r.has_install_job || CLOSED.has(r.status ?? "")) return r.status === "cancelled" ? null : "done";
  return "upcoming";
}

const sortKey = (r: VisitRow) => `${r.scheduled_date ?? "9999-12-31"} ${r.scheduled_time ?? "99:99"}`;

export function filterVisits(rows: VisitRow[] | null | undefined, tab: VisitTab): VisitRow[] {
  const out = (rows ?? []).filter((r) => visitTab(r) === tab);
  if (tab === "available") {
    // lead filtering: nearest first (reps get km from rep_offerable_leads; admins see all, by date)
    out.sort((a, b) => (a.offer_km ?? Infinity) - (b.offer_km ?? Infinity) || sortKey(a).localeCompare(sortKey(b)));
  } else {
    out.sort((a, b) => (tab === "done" ? sortKey(b).localeCompare(sortKey(a)) : sortKey(a).localeCompare(sortKey(b))));
  }
  return out;
}

export function suburbOf(address: string | null | undefined): string {
  if (!address) return "";
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[1] : parts[0] ?? "";
}

export function mapsLink(r: Pick<VisitRow, "lat" | "lng" | "address">): string | null {
  if (r.lat != null && r.lng != null) return `https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}`;
  if (r.address) return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(r.address)}`;
  return null;
}

/** Bottom-nav "Jobs" slot: reps get Visits; everyone else unchanged. */
export function jobsTabFor(isSalesRep: boolean): { to: string; label: string } {
  return isSalesRep ? { to: "/admin/visits", label: "Visits" } : { to: "/admin/jobs", label: "Jobs" };
}
