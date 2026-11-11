export const CANCEL_VISIT_REASONS = [
  { id: "cancelled_by_client", label: "Cancelled by client" },
  { id: "no_longer_needed", label: "No longer needed" },
  { id: "no_show", label: "No-show" },
] as const;

export type CancelVisitReasonId = (typeof CANCEL_VISIT_REASONS)[number]["id"];

export function cancelVisitReasonLabel(id: string | null | undefined): string | null {
  return CANCEL_VISIT_REASONS.find((r) => r.id === id)?.label ?? null;
}

/** Who may see Cancel visit. The server checks the same split again. */
export function canCancelVisit(perms: { admin?: boolean; rep?: boolean; office?: boolean } | null | undefined): boolean {
  return !!(perms?.admin || perms?.office || perms?.rep);
}
