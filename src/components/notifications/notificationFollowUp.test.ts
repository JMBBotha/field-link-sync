import { describe, expect, it } from "vitest";
import { alertLeadId, canMarkRead, leadIsClosedForAlert } from "./notificationFollowUp";

describe("closed lead alerts", () => {
  const unread = { id: "n1", type: "new_lead", related_id: "lead-1" };

  it("keeps a New Lead locked until it is opened", () => {
    expect(canMarkRead(unread, new Set())).toBe(false);
  });

  it("does not lock a New Lead once the lead is already closed", () => {
    expect(canMarkRead({ ...unread, metadata: { lead_closed: true } }, new Set())).toBe(true);
  });

  it("finds the lead on New Lead, Call Logged, and hot-lead alerts", () => {
    expect(alertLeadId({ type: "new_lead", related_id: "lead-1" })).toBe("lead-1");
    expect(alertLeadId({ type: "call_logged", related_id: "call-1", metadata: { lead_id: "lead-1" } })).toBe("lead-1");
    expect(alertLeadId({ type: "sales_nudge", related_id: "lead-1", metadata: { entity: "lead" } })).toBe("lead-1");
    expect(alertLeadId({ type: "sales_nudge", related_id: "quote-1", metadata: { entity: "quote" } })).toBeNull();
  });

  it("treats dismiss, archive, resolve, and accept as closed", () => {
    expect(leadIsClosedForAlert({ dismissed_at: "2026-11-16T14:00:00Z" })).toBe(true);
    expect(leadIsClosedForAlert({ archived_at: "2026-11-16T14:00:00Z" })).toBe(true);
    expect(leadIsClosedForAlert({ status: "accepted" })).toBe(true);
    expect(leadIsClosedForAlert({ lead_status: "resolved_before_visit" })).toBe(true);
    expect(leadIsClosedForAlert({ status: "pending" })).toBe(false);
  });
});
