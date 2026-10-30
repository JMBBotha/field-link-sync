import { describe, it, expect } from "vitest";
import { assignedLabel, isAssigned, cardHref } from "./assignedLabel";

describe("assigned rule", () => {
  it("treats a pending lead with an assigned tech as assigned", () => {
    expect(isAssigned({ assigned_agent_id: "t1" })).toBe(true);
    expect(isAssigned({ assigned_to: null, tech_name: " " })).toBe(false);
  });
  it("friendly label", () => {
    expect(assignedLabel("Innocent Mattienga ", "2026-11-10", "08:00:00")).toBe("Assigned to Innocent Mattienga · Tue 10 Nov, 08:00");
    expect(assignedLabel(null, "2026-11-10")).toBeNull();
  });
  it("card targets", () => {
    expect(cardHref({ job_id: "j", lead_id: "l" })).toBe("/admin/jobs/j");
    expect(cardHref({ lead_id: "l" })).toBe("/admin/bookings/l");
    expect(cardHref({})).toBeNull();
  });
});
