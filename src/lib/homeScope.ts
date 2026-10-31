/**
 * Whose deals the v8 home flow counts (Johan 31 Oct).
 * - Sales login linked to an admin account: company-wide (same as the admin home).
 * - Plain sales rep: their own quotes, i.e. sales_engineer_id is them.
 * - Everyone else: company-wide (RLS still scopes rows).
 */
export type HomeScope = "own" | "company";
export const homeScope = (role: string, linkedAdmin: string | null | undefined): HomeScope =>
  role === "sales" && !linkedAdmin ? "own" : "company";
export const quoteInScope = (q: { sales_engineer_id?: string | null }, scope: HomeScope, userId: string | null | undefined) =>
  scope === "company" || (!!userId && q.sales_engineer_id === userId);
/** One shared rule (Johan 31 Oct t2022u/t2023u): a sales login linked to an admin account works company-wide;
 * only a plain sales rep is limited to their own records. Use at every own-filter call site. */
export const ownScopeOnly = (isSalesRep: boolean, linkedAdmin: string | null | undefined) => isSalesRep && !linkedAdmin;
