import type { LeadStatusFilter } from "@/components/StatusFilterButtons";

/**
 * One status language for the whole map: every raw lead status folds into
 * one of 5 categories — Avail (pending), Claimed (accepted), Active
 * (in_progress), Done (completed + converted), Cancelled (cancelled + resolved_before_visit).
 */
export function leadStatusCategory(status: string | null | undefined): LeadStatusFilter {
  const s = (status || "").toLowerCase().trim();
  switch (s) {
    case "accepted":
    case "claimed":
    case "assigned":
      return "accepted";
    case "in_progress":
    case "in-progress":
    case "active":
      return "in_progress";
    case "completed":
    case "converted":
    case "done":
      return "completed";
    case "cancelled":
    case "canceled":
    case "resolved_before_visit":
      return "cancelled";
    case "pending":
    case "open":
    case "released":
    case "new":
    default:
      return "pending";
  }
}
