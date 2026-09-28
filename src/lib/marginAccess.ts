/**
 * Who sees the sales margin card. One rule:
 * - admin: every quote
 * - dispatcher (office, dispatch_role ≠ 'sales'): every quote
 * - sales rep (dispatch_role = 'sales'): only quotes they own (sales_engineer_id / created_by / owner_id)
 * - field agents / technicians: never; agent quote-builder mode never
 */
export interface MarginAccessInput {
  userId: string | null;
  roles: string[];
  dispatchRole: string | null;
  mode?: "admin" | "agent";
  quote: { sales_engineer_id?: string | null; created_by?: string | null; owner_id?: string | null } | null;
}

export function canSeeMargin({ userId, roles, dispatchRole, mode, quote }: MarginAccessInput): boolean {
  if (!userId || mode === "agent") return false;
  if (roles.includes("admin")) return true;
  const owns = !!quote && [quote.sales_engineer_id, quote.created_by, quote.owner_id].includes(userId);
  if (dispatchRole === "sales") return owns;
  if (roles.includes("dispatcher")) return true;
  return false;
}
