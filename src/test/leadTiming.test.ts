import { describe, expect, it } from "vitest";
import { leadTiming } from "@/lib/leadTiming";
import { timingLine } from "../../supabase/functions/_shared/websiteTiming";

describe("website timing", () => {
  it("formats the three choices", () => {
    expect(timingLine("asap")).toBe("Timing: ASAP");
    expect(timingLine("flexible")).toBe("Timing: Flexible");
    expect(timingLine("specific", "2026-10-14", "10:00:00")).toBe("Timing: Wed 14 Oct 10:00");
    expect(timingLine(undefined, "2026-10-14", "10:00")).toBe("");
  });
  it("reads it back from notes", () => {
    expect(leadTiming("Source: website\nTiming: ASAP\nx")).toBe("ASAP");
    expect(leadTiming("no timing")).toBeNull();
  });
});
