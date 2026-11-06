/**
 * Sales Jobs visibility: the signed-in salesperson sees a job they booked or are assigned to.
 * Includes a technician installation they sold or booked. Does not mean every salesperson
 * sees every technician diary, and does not treat a second login as the same person
 * (no rep_linked_admin expansion).
 *
 * Booked:
 *   jobs.created_by
 *   assignments.assigned_by (they handed the job to a technician)
 *   leads.created_by
 *   lead_assignment_log.assigned_by
 *   quotes.created_by on the job quote, variation quote, or a quote on the job's lead
 * Assigned:
 *   assignments.profile_id on a live row (not declined / cancelled / rejected)
 *   job_schedules.agent_id
 *   leads.assigned_agent_id
 *   quotes.sales_engineer_id and quotes.owner_id (same quote set as booked)
 *   customers.assigned_rep_id and customers.owner_rep_id
 *
 * The same fields are enforced in SQL by rep_booked_or_assigned_job / _lead.
 * Availability (Off / Busy / Available) is not an input.
 */

export type SalesJobClaim = {
  createdBy?: string | null;
  assignedByIds?: readonly string[];
  assigneeIds?: readonly string[];
  scheduleAgentIds?: readonly string[];
  quoteCreatedByIds?: readonly string[];
  quoteSalesEngineerIds?: readonly string[];
  quoteOwnerIds?: readonly string[];
  leadCreatedBy?: string | null;
  leadAssigneeId?: string | null;
  leadAssignedByIds?: readonly string[];
  customerAssignedRepId?: string | null;
  customerOwnerRepId?: string | null;
};

const same = (userId: string, id?: string | null) => !!id && id === userId;
const anyId = (userId: string, ids?: readonly string[]) => !!ids?.some((id) => id === userId);

export function salesBookedOrAssigned(userId: string | null | undefined, claim: SalesJobClaim): boolean {
  if (!userId) return false;
  return same(userId, claim.createdBy)
    || anyId(userId, claim.assignedByIds)
    || anyId(userId, claim.assigneeIds)
    || anyId(userId, claim.scheduleAgentIds)
    || anyId(userId, claim.quoteCreatedByIds)
    || anyId(userId, claim.quoteSalesEngineerIds)
    || anyId(userId, claim.quoteOwnerIds)
    || same(userId, claim.leadCreatedBy)
    || same(userId, claim.leadAssigneeId)
    || anyId(userId, claim.leadAssignedByIds)
    || same(userId, claim.customerAssignedRepId)
    || same(userId, claim.customerOwnerRepId);
}

/** job_tech_location: company admin, or a sales rep who booked or is assigned. Not the working technician. */
export function jobTechLocationAllowed(
  viewer: { userId: string | null | undefined; admin: boolean; salesRep: boolean },
  claim: SalesJobClaim,
): boolean {
  if (viewer.admin) return true;
  if (!viewer.salesRep) return false;
  return salesBookedOrAssigned(viewer.userId, claim);
}

export type SalesScheduleScope = { jobIds: Set<string>; leadIds: Set<string> };

export function scopeFromRpc(data: unknown): SalesScheduleScope {
  const row = data && typeof data === "object" ? data as { job_ids?: unknown; lead_ids?: unknown } : {};
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return { jobIds: new Set(ids(row.job_ids)), leadIds: new Set(ids(row.lead_ids)) };
}

/** A booked job with nobody on it still has to appear (the office unassigned rail stays hidden). */
export function attachOwnUnassigned<P extends { id: string }, B extends { personId: string | null }>(
  people: P[],
  blocks: B[],
  person: P,
): { people: P[]; blocks: B[] } {
  if (!blocks.some((b) => !b.personId)) return { people, blocks };
  return {
    people: [person, ...people.filter((p) => p.id !== person.id)],
    blocks: blocks.map((b) => (b.personId ? b : { ...b, personId: person.id })),
  };
}
