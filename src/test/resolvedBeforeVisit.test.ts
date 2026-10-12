import { describe, it, expect } from "vitest";
import { leadStatusCategory } from "@/lib/leadStatusCategory";
import { CLOSED_LEAD_STATUS, CLOSED_STATUS } from "@/hooks/useLeadInbox";
import { CLOSED_STATUSES } from "@/lib/todaysJobs";
import { visitTab } from "@/lib/visits";
import { leadStatusLabel, isCancelLikeLeadStatus } from "@/lib/leadStatus";
import { mapSpokenStatus } from "@/lib/mandy/mapStatus";

describe("resolved_before_visit lead status", () => {
  it("is closed like cancelled everywhere", () => {
    expect(leadStatusCategory("resolved_before_visit")).toBe("cancelled");
    expect(CLOSED_LEAD_STATUS).toContain("resolved_before_visit");
    expect(CLOSED_STATUS).toContain("resolved_before_visit");
    expect(CLOSED_STATUSES).toContain("resolved_before_visit");
    expect(isCancelLikeLeadStatus("resolved_before_visit")).toBe(true);
    expect(visitTab({ is_mine: true, status: "resolved_before_visit" } as any)).toBeNull();
  });
  it("has a proper label and voice mapping", () => {
    expect(leadStatusLabel("resolved_before_visit")).toBe("Resolved before visit");
    expect(mapSpokenStatus("resolved")).toBe("cancelled");
  });
});
