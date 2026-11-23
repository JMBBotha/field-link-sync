import { describe, expect, it } from "vitest";
import { isInboxLead } from "@/hooks/useLeadInbox";
import { inboxTone } from "@/lib/leadClock";
import { span } from "@/lib/leadFlow";
import { isNewUncontactedLead, newLeadsButtonTitle, newUncontactedLeads, type NewLeadRow } from "@/lib/newUncontactedLead";

const NOW = Date.parse("2026-11-23T08:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

/** What Jobs → Today used before this fix: pending, not merged, nobody assigned. */
function oldNeedsYou(l: NewLeadRow): boolean {
  return l.status === "pending" && !l.deleted_at && !l.merged_into_id && !l.assigned_agent_id;
}

const isanku: NewLeadRow = {
  id: "isanku",
  customer_name: "Isanku Logistics",
  customer_address: "3 Gulfstream Ave Airport City",
  status: "pending",
  lead_status: "classified",
  primary_intent: "sales",
  created_at: daysAgo(3),
  assigned_agent_id: null,
  scheduled_date: null,
  first_contact_at: null,
};

const munirah: NewLeadRow = {
  id: "munirah",
  customer_name: "Munirah Botha",
  customer_address: "12 stibitz street Westlake Business Park",
  status: "pending",
  lead_status: "new",
  primary_intent: "sales",
  service_type: "New Quote",
  created_at: daysAgo(5),
  assigned_agent_id: "sales-rep",
  scheduled_date: null,
  first_contact_at: null,
};

describe("new / not contacted lead", () => {
  it("counts Munirah Botha, assigned with no visit, who Needs you used to drop", () => {
    const rows = [isanku, munirah];
    expect(rows.filter(isInboxLead)).toHaveLength(2);
    expect(rows.filter(oldNeedsYou)).toEqual([isanku]);
    expect(newUncontactedLeads(rows).map((l) => l.id)).toEqual(["munirah", "isanku"]);
    expect(newLeadsButtonTitle(2)).toBe("2 new leads");
    const tone = inboxTone(newUncontactedLeads(rows), NOW)!;
    expect(tone.tone).toBe("red");
    expect(span(tone.oldestMs)).toBe("5d");
  });

  it("drops a booked visit, a contacted lead, an archive, a merge, and a hang-up", () => {
    expect(isNewUncontactedLead({ ...munirah, assigned_agent_id: "rep", scheduled_date: "2026-11-24" })).toBe(false);
    expect(isNewUncontactedLead({ ...isanku, first_contact_at: daysAgo(1) })).toBe(false);
    expect(isNewUncontactedLead({ ...isanku, archived_at: daysAgo(1) })).toBe(false);
    expect(isNewUncontactedLead({ ...isanku, dismissed_at: daysAgo(1) })).toBe(false);
    expect(isNewUncontactedLead({ ...isanku, closed_at: daysAgo(1) })).toBe(false);
    expect(isNewUncontactedLead({ ...isanku, merged_into_id: "other" })).toBe(false);
    expect(isNewUncontactedLead({ ...isanku, deleted_at: daysAgo(1) })).toBe(false);
    expect(isNewUncontactedLead({ ...isanku, status: "cancelled" })).toBe(false);
    expect(isNewUncontactedLead({
      customer_name: "Unknown Caller",
      customer_address: "Address pending — inbound call",
      status: "pending",
      created_at: daysAgo(1),
      notes: "Call duration: 5s\nEnded reason: customer-ended-call\nAI: Thanks for calling",
    })).toBe(false);
  });

  it("keeps a short call once the caller left a name", () => {
    expect(isNewUncontactedLead({
      customer_name: "Thabo Nkosi",
      customer_address: "Address pending — inbound call",
      status: "pending",
      created_at: daysAgo(1),
      notes: "Call duration: 8s\nEnded reason: customer-ended-call\nUser: Thabo",
    })).toBe(true);
  });
});
