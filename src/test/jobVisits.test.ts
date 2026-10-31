import { describe, expect, it } from "vitest";
import { hoursLabel, nextVisit, sortVisits, totalVisitMinutes, visitMinutes, visitsChanged, visitsError } from "@/lib/jobVisits";

const two = [{ id: "b", date: "2026-11-03", start: "12:00", end: "14:00" }, { id: "a", date: "2026-11-02", start: "14:00", end: "17:00" }];
describe("job visits", () => {
  it("adds up hours", () => { expect(visitMinutes(two[1])).toBe(180); expect(totalVisitMinutes(two)).toBe(300); expect(hoursLabel(300)).toBe("5h"); expect(hoursLabel(90)).toBe("1h 30m"); });
  it("sorts by date", () => { expect(sortVisits(two).map((v) => v.id)).toEqual(["a", "b"]); });
  it("validates", () => {
    expect(visitsError(two)).toBeNull();
    expect(visitsError([])).toMatch(/at least one/);
    expect(visitsError([{ date: "2026-11-02", start: "14:00", end: "13:00" }])).toMatch(/ends before/);
    expect(visitsError([two[1], { ...two[0], date: "2026-11-02" }])).toMatch(/same day/);
    expect(visitsError([{ date: "", start: "08:00", end: "09:00" }])).toMatch(/needs a date/);
  });
  it("detects changes regardless of order", () => {
    expect(visitsChanged(two, [...two].reverse())).toBe(false);
    expect(visitsChanged(two, [two[0], { ...two[1], end: "16:30" }])).toBe(true);
  });
  it("suggests the next day", () => { expect(nextVisit(two, "2026-10-31")).toMatchObject({ date: "2026-11-04", start: "12:00", end: "14:00" }); });
});
