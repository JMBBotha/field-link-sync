import { MASSAIR_IND_ID, TEST_HVAC_ID } from "@/lib/adminHomeCount";
import { resolveLane } from "@/hooks/useLaneStaff";

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
};

/**
 * Technicians for Book a job (upcoming, past, and the project house).
 * Same lane as dispatch / AppointmentPicker (`resolveLane` === service):
 * profiles.dispatch_role technician, or an independent tech. Not user_roles,
 * and not "Available right now" — that filter hides the only company tech
 * whenever they are offline.
 */
export function bookingTechnicians(
  rows: BookingTechRow[] | null | undefined,
  companyId: string | null | undefined,
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
  return out;
}

export type BookingTechListState = "hidden" | "loading" | "error" | "empty" | "ready";

/**
 * What the past-work technician menu should show.
 * A disabled or in-flight query has no rows yet — that is loading, not an empty company.
 * A missing company, or a failed read, is an error the user can retry. A finished read
 * with nobody left after the company / archive / lane filters is the only empty state.
 */
export function bookingTechListState(args: {
  companyId: string | null | undefined;
  companyLoading: boolean;
  companyError: boolean;
  accessLoading: boolean;
  canLog: boolean;
  /** The menu asked for the list. False while the dialog is shut or the person cannot log. */
  queryEnabled: boolean;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  count: number;
}): BookingTechListState {
  if (!args.canLog && !args.accessLoading) return "hidden";
  if (args.accessLoading || args.companyLoading) return "loading";
  if (!args.companyId || args.companyError) return "error";
  if ((EXCLUDED_TECH_COMPANY_IDS as readonly string[]).includes(args.companyId)) return "empty";
  // Pending covers the first paint, before the request's fetchStatus flips. A disabled
  // query is also pending, so this only applies once the menu has actually asked.
  if (args.queryEnabled && (args.isPending || (args.isFetching && args.count === 0))) return "loading";
  if (args.isError) return "error";
  if (args.count === 0) return "empty";
  return "ready";
}
