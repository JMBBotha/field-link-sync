// One definition of a "new / not contacted" lead.
// The red sidebar button and the Jobs "Needs you" list both use this.
// A booked visit (assignee and a date) is no longer new. Naming a salesperson
// without a visit does not take the lead off the list — nobody has been reached.
// Hang-ups are not leads. Archived, dismissed, closed, deleted, and merged rows drop off.
import { isBareHangup, userSpeech } from "../../supabase/functions/_shared/bareHangup";

const CLOSED_LEAD_STATUS = ["completed", "lost", "cancelled", "resolved_before_visit"];
const CLOSED_STATUS = ["completed", "converted", "cancelled", "resolved_before_visit"];

export type NewLeadRow = {
  id?: string;
  deleted_at?: string | null;
  archived_at?: string | null;
  dismissed_at?: string | null;
  closed_at?: string | null;
  merged_into_id?: string | null;
  lead_status?: string | null;
  status?: string | null;
  assigned_agent_id?: string | null;
  scheduled_date?: string | null;
  first_contact_at?: string | null;
  customer_name?: string | null;
  customer_address?: string | null;
  notes?: string | null;
  source?: string | null;
  created_at?: string | null;
  company_id?: string | null;
  primary_intent?: string | null;
  service_type?: string | null;
  customer_phone?: string | null;
  call_area?: string | null;
};

/** A short call stored as a lead (no name, no details). Follow-ups live on call_admin_followups and never reach this list. */
export function isHangupLead(lead: Pick<NewLeadRow, "customer_name" | "customer_address" | "notes" | "source"> | null | undefined): boolean {
  if (!lead) return false;
  const notes = lead.notes || "";
  const dur = notes.match(/Call duration:\s*([\d.]+)s/i) || notes.match(/End-of-call update \(([\d.]+)s/i);
  if (!dur) return false;
  const ended = notes.match(/Ended reason:\s*([^\n]+)/i);
  return isBareHangup({
    durationSeconds: dur[1],
    callerName: lead.customer_name,
    address: lead.customer_address,
    userText: userSpeech(null, notes),
    endedReason: ended?.[1] ?? null,
    thresholdSeconds: 15,
  });
}

export function isNewUncontactedLead(lead: NewLeadRow | null | undefined): boolean {
  if (!lead) return false;
  if (lead.deleted_at || lead.archived_at || lead.dismissed_at || lead.closed_at || lead.merged_into_id) return false;
  if (lead.lead_status && CLOSED_LEAD_STATUS.includes(lead.lead_status)) return false;
  if (lead.status && CLOSED_STATUS.includes(lead.status)) return false;
  if (lead.status && lead.status !== "pending") return false;
  if (lead.first_contact_at) return false;
  if (lead.assigned_agent_id && lead.scheduled_date) return false;
  if (isHangupLead(lead)) return false;
  return true;
}

/** Oldest first, so the age on the red button is the first card. */
export function newUncontactedLeads<T extends NewLeadRow>(rows: T[] | null | undefined): T[] {
  return (rows || []).filter(isNewUncontactedLead).sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
}

export function newLeadsButtonTitle(count: number): string {
  return count > 0 ? `${count} new lead${count === 1 ? "" : "s"}` : "New leads";
}
