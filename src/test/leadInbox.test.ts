import { describe, it, expect } from "vitest";
import { isInboxLead } from "@/hooks/useLeadInbox";
describe("inbox rule", () => {
  it("includes lead missing agent", () => expect(isInboxLead({ status: "pending", scheduled_date: "2026-09-01" })).toBe(true));
  it("includes lead missing date", () => expect(isInboxLead({ status: "pending", assigned_agent_id: "a" })).toBe(true));
  it("excludes assigned+scheduled", () => expect(isInboxLead({ assigned_agent_id: "a", scheduled_date: "2026-09-01" })).toBe(false));
  it("excludes closed", () => expect(isInboxLead({ lead_status: "lost" })).toBe(false));
  it("excludes deleted", () => expect(isInboxLead({ deleted_at: "x" })).toBe(false));
});
