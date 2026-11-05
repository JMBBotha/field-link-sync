/** Dormant companies use companies.status = 'archived' (no separate 'dormant' value). */

export const ACTIVE_COMPANY_STATUS = "active";

export const DORMANT_BADGE = "Archived / Dormant — history only";

/** Missing status is treated as active, matching the column default. */
export function isActiveCompany(row: { status?: string | null } | null | undefined): boolean {
  return (row?.status || ACTIVE_COMPANY_STATUS) === ACTIVE_COMPANY_STATUS;
}

export function activeCompanies<T extends { status?: string | null }>(rows: T[] | null | undefined): T[] {
  return (rows || []).filter(isActiveCompany);
}
