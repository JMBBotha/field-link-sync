export function isSalesRep(roles: string[], dispatchRole: string | null | undefined): boolean {
  return !roles.includes("admin") && roles.includes("dispatcher") && (dispatchRole === "sales" || dispatchRole === "sales_engineer");
}
