/** Booking (lead without a job) edit rules. Mirrors update_booking_details server checks. */
export type BookingPerms = { admin: boolean; rep: boolean; view?: boolean; office?: boolean };
export function editableBookingFields(p: BookingPerms | null | undefined) {
  const admin = !!p?.admin, rep = !!p?.rep;
  return { any: admin || rep, date: admin || rep, time: admin || rep, notes: admin || rep, service: admin, address: admin };
}
/** Only send what changed; reps never send admin-only fields. */
export function bookingPatch(
  p: BookingPerms | null | undefined,
  before: { date: string | null; time: string | null; notes: string | null; service: string | null; address: string | null },
  after: { date: string; time: string; notes: string; service: string; address: string },
) {
  const f = editableBookingFields(p);
  const out: Record<string, string> = {};
  const t5 = (v: string | null) => (v ?? "").slice(0, 5);
  if (f.date && after.date && after.date !== (before.date ?? "")) out.p_date = after.date;
  if (f.time && after.time && after.time !== t5(before.time)) out.p_time = after.time;
  if (f.notes && after.notes.trim() !== (before.notes ?? "").trim()) out.p_notes = after.notes;
  if (f.service && after.service.trim() && after.service.trim() !== (before.service ?? "")) out.p_service_type = after.service.trim();
  if (f.address && after.address.trim() && after.address.trim() !== (before.address ?? "")) out.p_address = after.address.trim();
  return out;
}
/** Plain-English booking status from leads.status + lead_status. */
export function bookingStatus(status: string | null | undefined, leadStatus?: string | null, assigned?: boolean) {
  const s = (status || "").toLowerCase();
  if (["cancelled", "canceled", "lost", "rejected"].includes(s)) return { label: "Cancelled", tone: "red" as const };
  if (s === "completed" || s === "converted" || s === "won") return { label: "Completed", tone: "green" as const };
  if (s === "in_progress") return { label: "In progress", tone: "blue" as const };
  if (assigned || s === "assigned" || s === "scheduled") return { label: "Booked", tone: "green" as const };
  if ((leadStatus || "").toLowerCase() === "new") return { label: "New – not booked", tone: "amber" as const };
  return { label: "Pending – needs a technician", tone: "amber" as const };
}
