/**
 * Lead status vocabulary shared across boards, filters and badges.
 * "resolved_before_visit" = the client sorted it before anyone went out:
 * closed/terminal exactly like "cancelled" (hidden from open boards, counted
 * as cancelled in map chips), but never invoiced, commissioned or messaged.
 */
export const RESOLVED_BEFORE_VISIT = "resolved_before_visit" as const;

export const LEAD_STATUS_LABELS: Record<string, string> = {
  pending: "Avail",
  accepted: "Claimed",
  in_progress: "Active",
  completed: "Done",
  converted: "Converted",
  cancelled: "Cancelled",
  [RESOLVED_BEFORE_VISIT]: "Resolved before visit",
};

/** Statuses that close a lead without a visit (cancel-like). */
export const CANCEL_LIKE_LEAD_STATUSES = ["cancelled", "canceled", RESOLVED_BEFORE_VISIT];

export const isCancelLikeLeadStatus = (s?: string | null) =>
  CANCEL_LIKE_LEAD_STATUSES.includes(String(s || "").toLowerCase().trim());

export const leadStatusLabel = (s?: string | null) =>
  LEAD_STATUS_LABELS[String(s || "").toLowerCase().trim()] ?? String(s || "").replace(/_/g, " ");
