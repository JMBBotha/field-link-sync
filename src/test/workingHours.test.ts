import { describe, it, expect } from "vitest";
import { resolveWorkWindow, freeGaps, mergedMinutes, blockedSpan } from "@/components/calendar/calendarModel";
import { chipLane } from "@/lib/cardModel";

describe("working hours helpers", () => {
  it("window falls back person -> company -> default", () => {
    expect(resolveWorkWindow(6, { is_working: true, start_time: "09:00:00", end_time: "13:00:00" }, { work_days: [1], work_start: "07:00", work_end: "16:00" }))
      .toEqual({ is_working: true, start_time: "09:00", end_time: "13:00", source: "person" });
    expect(resolveWorkWindow(6, null, { work_days: [1, 2, 3, 4, 5, 6], work_start: "07:00:00", work_end: "16:00:00" }))
      .toEqual({ is_working: true, start_time: "07:00", end_time: "16:00", source: "company" });
    expect(resolveWorkWindow(0, null, null)).toEqual({ is_working: false, start_time: "08:00", end_time: "17:00", source: "default" });
  });
  it("free gaps use real hours and skip blocked time; none when off", () => {
    const gaps = freeGaps([{ start_time: "09:00", end_time: "10:00" }], { start_time: "08:30", end_time: "16:00" }, [{ start_time: "13:00", end_time: "15:00" }]);
    expect(gaps.map(g => `${g.start}-${g.end}`)).toEqual(["08:30-09:00", "10:00-13:00", "15:00-16:00"]);
    expect(freeGaps([], { start_time: "08:00", end_time: "17:00", is_working: false })).toEqual([]);
  });
  it("load counts overlapping bookings once", () => {
    expect(mergedMinutes([{ start_time: "14:00", end_time: "18:00" }, { start_time: "15:00", end_time: "16:00" }])).toBe(240);
    expect(mergedMinutes([{ start_time: "08:00", end_time: "09:00" }, { start_time: "10:00", end_time: "11:00" }])).toBe(120);
  });
  it("blocked rows clip to the SAST day", () => {
    expect(blockedSpan({ starts_at: "2026-10-09T11:00:00Z", ends_at: "2026-10-09T13:00:00Z" }, "2026-10-09")).toEqual({ start_time: "13:00", end_time: "15:00" });
    expect(blockedSpan({ starts_at: "2026-10-01T00:00:00Z", ends_at: "2026-10-02T00:00:00Z" }, "2026-10-09")).toBeNull();
  });
  it("install chip label", () => {
    expect(chipLane("service", "Split unit Installation")).toBe("install");
    expect(chipLane("service", "Repair")).toBe("service");
    expect(chipLane("sales", "install quote")).toBe("sales");
  });
});
