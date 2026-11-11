/** Who a salesperson may book. Office and admin callers are not filtered. */

import { isSalesRep } from "@/lib/roleAccess";

export const NO_TECHS_ASSIGNED = "No technicians assigned to you yet — ask an admin.";

/** Badge text only. The stored role stays dispatcher. */
export function memberRoleBadge(
  role: string,
  roles: readonly string[],
  dispatchRole: string | null | undefined,
  fallback: string,
): string {
  if (role === "dispatcher" && isSalesRep([...roles], dispatchRole)) return "Salesperson";
  return fallback;
}

export function bookableForCaller<T extends { id: string }>(
  rows: readonly T[] | null | undefined,
  isSalesRep: boolean,
  assignedIds: readonly string[] | null | undefined,
): T[] {
  const list = [...(rows || [])];
  if (!isSalesRep) return list;
  const allow = new Set(assignedIds || []);
  return list.filter((row) => allow.has(row.id));
}

/** Team row: dispatcher on the sales lane. Independent techs stay on the service lane. */
export function isSalespersonProfile(m: {
  dispatch_role?: string | null;
  participant_type?: string | null;
}): boolean {
  if (m.participant_type === "independent_tech") return false;
  return m.dispatch_role === "sales" || m.dispatch_role === "sales_engineer";
}
