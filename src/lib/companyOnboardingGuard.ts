/**
 * Who may change an existing company's name, rates, or services.
 * Mirrors public.can_update_company: the company owner, an admin of that
 * company, or the Massair platform owner. A dispatcher, salesperson, or
 * other invited member is none of those.
 */
export type CompanyUpdateAccess = {
  companyId: string | null;
  isOwner: boolean;
  /** company_members.role = 'admin' for this company. */
  memberAdmin: boolean;
  /** app role admin and a member of this company (not a global admin of somewhere else). */
  adminRoleInCompany: boolean;
  /** Massair CT admin or platform role. Keeps Johan’s company-wide update access. */
  platformOwner: boolean;
};

export function mayUpdateExistingCompany(access: CompanyUpdateAccess): boolean {
  if (!access.companyId) return false;
  return access.isOwner || access.memberAdmin || access.adminRoleInCompany || access.platformOwner;
}

/** A person who already belongs to a company does not run company onboarding. */
export function shouldSkipCompanyOnboarding(profile: { company_id?: string | null } | null | undefined): boolean {
  return !!profile?.company_id;
}

/**
 * What the onboarding wizard may do with a company row.
 * create — approved founder with no company yet (fl_found_company).
 * skip — company_id is already set. The wizard does not rewrite that company.
 * Owners and admins edit it in Settings. Invited staff fail mayUpdateExistingCompany
 * as well, so a later caller still cannot write the row.
 */
export function companyOnboardingWrite(
  profile: { company_id?: string | null } | null | undefined,
): "create" | "skip" {
  return shouldSkipCompanyOnboarding(profile) ? "skip" : "create";
}
