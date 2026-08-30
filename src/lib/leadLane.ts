/**
 * Sales vs Service lane helpers — locked product spine.
 *
 * A lead's lane lives on `leads.primary_intent` ("sales" | "service").
 * Unknown lane => primary_intent null + needs_manual_assignment true, lead stays
 * in the inbox and is NEVER broadcast.
 */

export type LeadLane = "sales" | "service";

export const SERVICE_TYPES = [
  "Sales/Consultation",
  "Technical/Repairs",
  "Other",
] as const;

export type ServiceTypeOption = (typeof SERVICE_TYPES)[number];

/** Map the human service type to a lane. Returns null when unknown. */
export function laneFromServiceType(serviceType?: string | null): LeadLane | null {
  if (!serviceType) return null;
  const s = serviceType.toLowerCase();
  if (s.includes("sales") || s.includes("consult") || s.includes("quote")) return "sales";
  if (
    s.includes("technical") ||
    s.includes("repair") ||
    s.includes("service") ||
    s.includes("maintenance") ||
    s.includes("install") ||
    s.includes("breakdown")
  ) {
    return "service";
  }
  return null;
}

/**
 * Fields to write on a lead when its lane is set/changed.
 * Keep `lead_status` on the locked enum — classified when the lane is known,
 * new while it is still unknown.
 */
export function leadLaneFields(lane: LeadLane | null) {
  return {
    primary_intent: lane,
    needs_manual_assignment: lane === null,
    lead_status: lane ? "classified" : "new",
  } as const;
}

export const LANE_META: Record<LeadLane, { label: string; short: string; className: string }> = {
  sales: {
    label: "Sales",
    short: "Sales",
    className:
      "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  service: {
    label: "Service",
    short: "Service",
    className:
      "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
};

export const UNKNOWN_LANE_META = {
  label: "Needs lane",
  className: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
};

export function laneOf(lead: { primary_intent?: string | null; service_type?: string | null }): LeadLane | null {
  const pi = lead.primary_intent;
  if (pi === "sales" || pi === "service") return pi;
  return null;
}
