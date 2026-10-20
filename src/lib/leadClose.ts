/** Lead close/dismiss reason lists (Johan 20 Oct 11:43–11:46). Lost is company-level learning only, never per person. */
export const DISMISS_EXAMPLES = ["Test call", "Phoned by accident", "Wrong number", "Spam"];
export const NOT_REAL_JOB_LABEL = "Estimate only – follow up later";
export const NOT_REAL_JOB_REASONS = ["Estimate only – follow up later", "Price enquiry only", "Tyre kicker", "Duplicate", "Unreachable", "Other"];
export const LOST_LABEL = "Lost (after visit + quote)";
export const LOST_REASONS = ["Price – kept our margins", "Went with another company", "Timing / postponed", "Changed mind", "Other"];
export type CloseOutcome = "lost" | "not_real_job";
export function closedLabel(l: { dismissed_at?: string | null; close_outcome?: string | null } | null | undefined): string | null {
  if (!l) return null;
  if (l.dismissed_at) return "Dismissed";
  if (l.close_outcome === "lost") return "Closed · lost";
  if (l.close_outcome === "not_real_job") return "Closed · follow up later";
  return null;
}
