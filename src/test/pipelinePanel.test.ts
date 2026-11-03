import { describe, it, expect } from "vitest";
import { pipelineTechLine, partsApply } from "@/lib/pipelinePanel";
import { requestBadgeLabel } from "@/lib/requestBadge";
describe("pipeline panel", () => {
  it("shows assigned tech and booked time", () => expect(pipelineTechLine("Tech One", "2026-11-10", "08:00:00")).toEqual({ name: "Tech One", when: "Tue 10 Nov, 08:00" }));
  it("no tech -> null (picker)", () => expect(pipelineTechLine(null, "2026-11-10", "08:00")).toBeNull());
  it("tech without time", () => expect(pipelineTechLine("Tech One", null, null)?.when).toBe("No time booked yet"));
  it("parts only when set", () => { expect(partsApply({})).toBe(false); expect(partsApply({ parts_status: "pending" })).toBe(true); });
});
describe("request badge", () => {
  it("uses job type", () => expect(requestBadgeLabel("service", "installation")).toBe("Installation"));
  it("falls back to request type", () => expect(requestBadgeLabel("service", null)).toBe("Service"));
});
