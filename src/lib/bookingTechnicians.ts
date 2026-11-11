import { MASSAIR_IND_ID, TEST_HVAC_ID } from "@/lib/adminHomeCount";
import { resolveLane } from "@/hooks/useLaneStaff";
import { bookableForCaller } from "@/lib/salesTechAccess";

/** Companies that must never contribute a technician to Book a job. */
export const EXCLUDED_TECH_COMPANY_IDS = [TEST_HVAC_ID, MASSAIR_IND_ID] as const;

export type BookingTechRow = {
  id: string;
  full_name?: string | null;
  company_id?: string | null;
  dispatch_role?: string | null;
  participant_type?: string | null;
  dispatch_active?: boolean | null;
  archived_at?: string | null;
  /** Present on profiles. Ignored: a tech who is offline still did the visit. */
  availability_status?: string | null;
  /**
   * Admin-added technician with no sign-in. Ignored here: Book a job, the job
   * page, and the project house still list them. Offers and device alerts do not.
   */
  no_login?: boolean | null;
};

/**
 * Technicians for Book a job (upcoming, past, and the project house).
 * Same lane as dispatch / AppointmentPicker (`resolveLane` === service):
 * profiles.dispatch_role technician, or an independent tech. Not user_roles,
 * and not "Available right now" — that filter hides the only company tech
 * whenever they are offline. no_login does not remove them: the office books
 * and logs their work. Live offers and device alerts exclude them in SQL.
 */
export function bookingTechnicians(
  rows: BookingTechRow[] | null | undefined,
  companyId: string | null | undefined,
  scope?: { salesRep?: boolean; assignedIds?: readonly string[] | null },
): { id: string; name: string }[] {
  if (!companyId || (EXCLUDED_TECH_COMPANY_IDS as readonly string[]).includes(companyId)) return [];
  const seen = new Set<string>();
  const out: { id: string; name: string }[] = [];
  for (const row of rows || []) {
    if (!row?.id || seen.has(row.id)) continue;
    if (row.company_id !== companyId) continue;
    if ((EXCLUDED_TECH_COMPANY_IDS as readonly string[]).includes(row.company_id)) continue;
    if (row.dispatch_active !== true || row.archived_at) continue;
    if (resolveLane(row) !== "service") continue;
    seen.add(row.id);
    out.push({ id: row.id, name: row.full_name?.trim() || "Technician" });
  }
  out.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  if (scope?.salesRep) return bookableForCaller(out, true, scope.assignedIds);
  return out;
}
