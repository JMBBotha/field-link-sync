export type UnitRow = { id: string; unit_label: string | null; position: string | null; brand: string | null; model: string | null; serial_number: string | null };
/** Which edit fields a login gets. Mirrors update_job_details server checks. */
export function editableJobFields(p: { admin: boolean; rep: boolean } | null | undefined) {
  const admin = !!p?.admin, rep = !!p?.rep;
  return { any: admin || rep, schedule: admin || rep, notes: admin || rep, tech: admin, units: admin };
}
/** Who may add job photos: assigned tech, the client's rep, admins (incl. linked admin), and non-sales office staff. */
export function canAddJobPhotos(p: { admin: boolean; rep: boolean; tech: boolean } | null | undefined, officeStaff: boolean) {
  return !!(p?.admin || p?.rep || p?.tech || officeStaff);
}
