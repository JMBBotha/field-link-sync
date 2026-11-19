/**
 * Who can be named on a sales lead, and who may appear in Edit > Assigned To.
 * The assign RPC repeats these rules in SQL. This filter is what the pickers show.
 */

export type StaffPickRow = {
  id: string;
  full_name?: string | null;
  company_id?: string | null;
  dispatch_role?: string | null;
  participant_type?: string | null;
  dispatch_active?: boolean | null;
  archived_at?: string | null;
};

export type StaffChoice = { id: string; name: string };

function nameOf(row: StaffPickRow): string {
  return row.full_name?.trim() || "Unnamed";
}

/** Active person on this company: not archived, dispatch still on, same company. */
export function isActiveCompanyStaff(row: StaffPickRow | null | undefined, companyId: string | null | undefined): boolean {
  if (!row?.id || !companyId) return false;
  if (row.company_id !== companyId) return false;
  if (row.dispatch_active !== true) return false;
  if (row.archived_at) return false;
  return true;
}

/**
 * Sales lane, same rule as resolveLane: sales or sales_engineer, and not an
 * independent tech (those are service-only even if the role says sales).
 */
export function isSalesLaneStaff(row: StaffPickRow | null | undefined): boolean {
  if (!row) return false;
  if (row.dispatch_role !== "sales" && row.dispatch_role !== "sales_engineer") return false;
  if (row.participant_type === "independent_tech") return false;
  return true;
}

export function activeCompanyStaff(rows: StaffPickRow[] | null | undefined, companyId: string | null | undefined): StaffChoice[] {
  if (!companyId) return [];
  const seen = new Set<string>();
  const out: StaffChoice[] = [];
  for (const row of rows || []) {
    if (!isActiveCompanyStaff(row, companyId) || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push({ id: row.id, name: nameOf(row) });
  }
  out.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return out;
}

/** Active same-company salespeople. No visit time is involved. */
export function salesRepCandidates(rows: StaffPickRow[] | null | undefined, companyId: string | null | undefined): StaffChoice[] {
  if (!companyId) return [];
  const seen = new Set<string>();
  const out: StaffChoice[] = [];
  for (const row of rows || []) {
    if (!isActiveCompanyStaff(row, companyId) || !isSalesLaneStaff(row) || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push({ id: row.id, name: nameOf(row) });
  }
  out.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return out;
}
