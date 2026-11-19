export function isSalesRep(roles: string[], dispatchRole: string | null | undefined): boolean {
  return !roles.includes("admin") && roles.includes("dispatcher") && (dispatchRole === "sales" || dispatchRole === "sales_engineer");
}

const WRITE_ROLES = ["admin", "dispatcher", "field_agent", "platform_super_admin", "platform_ops"];

/** Viewer with no write role. A person who is also admin, office, or tech is not read-only. */
export function isReadonlyRoleSet(roles: string[]): boolean {
  return roles.includes("viewer") && !roles.some((role) => WRITE_ROLES.includes(role));
}

/**
 * Route access. A pure viewer may open screens so a designer can look around.
 * Sales-rep denial and an explicit denyViewer still apply. Platform pages keep their own gate.
 */
export function roleCanView(
  roles: string[],
  allowed: string[],
  opts: { denySalesRep?: boolean; isSalesRep?: boolean; denyViewer?: boolean } = {},
): boolean {
  if (opts.denySalesRep && opts.isSalesRep) return false;
  if (roles.some((role) => allowed.includes(role))) return true;
  if (!opts.denyViewer && isReadonlyRoleSet(roles)) return true;
  return false;
}
