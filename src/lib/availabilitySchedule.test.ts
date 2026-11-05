import { describe, expect, it } from "vitest";
import {
  MASSAIR_WEEK_TEMPLATE,
  desiredIdleStatus,
  isInsideWindow,
  mayShareLocation,
  nextBoundary,
  toggleDay,
  type AvailabilitySchedule,
} from "./availabilitySchedule";

const at = (iso: string) => new Date(iso);

function schedule(over: Partial<AvailabilitySchedule> = {}): AvailabilitySchedule {
  return {
    enabled: true,
    days: [...MASSAIR_WEEK_TEMPLATE.days],
    start: MASSAIR_WEEK_TEMPLATE.start,
    end: MASSAIR_WEEK_TEMPLATE.end,
    timezone: MASSAIR_WEEK_TEMPLATE.timezone,
    overrideStatus: null,
    overrideUntil: null,
    ...over,
  };
}

describe("weekly availability window", () => {
  it("flips Available inside the Massair Mon–Fri 07:00–18:00 window and Off outside it", () => {
    const s = schedule();
    expect(desiredIdleStatus(s, at("2026-11-05T08:00:00.000Z"))).toBe("available"); // Thu 10:00 SAST
    expect(desiredIdleStatus(s, at("2026-11-05T05:00:00.000Z"))).toBe("available"); // Thu 07:00 SAST
    expect(desiredIdleStatus(s, at("2026-11-05T04:59:00.000Z"))).toBe("offline"); // Thu 06:59 SAST
    expect(desiredIdleStatus(s, at("2026-11-05T16:00:00.000Z"))).toBe("offline"); // Thu 18:00 SAST, end is exclusive
    expect(desiredIdleStatus(s, at("2026-11-07T08:00:00.000Z"))).toBe("offline"); // Sat 10:00 SAST
    expect(isInsideWindow(s, at("2026-11-05T08:00:00.000Z"))).toBe(true);
  });

  it("lets one person work fewer days and different hours than the Massair template", () => {
    const tueThu = schedule({ days: [2, 4], start: "08:00", end: "16:00" });
    expect(desiredIdleStatus(tueThu, at("2026-11-03T07:00:00.000Z"))).toBe("available"); // Tue 09:00 SAST
    expect(desiredIdleStatus(tueThu, at("2026-11-05T07:00:00.000Z"))).toBe("available"); // Thu 09:00 SAST
    expect(desiredIdleStatus(tueThu, at("2026-11-03T14:00:00.000Z"))).toBe("offline"); // Tue 16:00 SAST
    expect(desiredIdleStatus(tueThu, at("2026-11-04T07:00:00.000Z"))).toBe("offline"); // Wed is not one of their days
    expect(desiredIdleStatus(tueThu, at("2026-11-06T07:00:00.000Z"))).toBe("offline"); // Fri 09:00 SAST

    const wednesdayOnly = schedule({ days: [3], start: "09:00", end: "12:00" });
    expect(desiredIdleStatus(wednesdayOnly, at("2026-11-04T08:00:00.000Z"))).toBe("available"); // Wed 10:00
    expect(desiredIdleStatus(wednesdayOnly, at("2026-11-05T08:00:00.000Z"))).toBe("offline");

    const withSaturday = schedule({ days: [1, 2, 3, 4, 5, 6], start: "09:00", end: "13:00" });
    expect(desiredIdleStatus(withSaturday, at("2026-11-07T08:00:00.000Z"))).toBe("available"); // Sat 10:00
    expect(desiredIdleStatus(withSaturday, at("2026-11-07T12:00:00.000Z"))).toBe("offline"); // Sat 14:00
  });

  it("holds a manual Available or Off only until the next boundary", () => {
    const s = schedule();
    const endThursday = nextBoundary(s, at("2026-11-05T08:00:00.000Z"));
    expect(endThursday?.toISOString()).toBe("2026-11-05T16:00:00.000Z"); // Thu 18:00 SAST

    const offlineNow = schedule({ overrideStatus: "offline", overrideUntil: endThursday });
    expect(desiredIdleStatus(offlineNow, at("2026-11-05T08:00:00.000Z"))).toBe("offline");
    expect(desiredIdleStatus(offlineNow, at("2026-11-05T15:59:00.000Z"))).toBe("offline");
    // Friday 08:00 SAST: override has expired and the window is open again.
    expect(desiredIdleStatus(offlineNow, at("2026-11-06T06:00:00.000Z"))).toBe("available");

    const fridayOpen = nextBoundary(s, at("2026-11-05T17:00:00.000Z")); // Thu 19:00 → Fri 07:00
    expect(fridayOpen?.toISOString()).toBe("2026-11-06T05:00:00.000Z");
    const availableNow = schedule({ overrideStatus: "available", overrideUntil: fridayOpen });
    expect(desiredIdleStatus(availableNow, at("2026-11-05T17:00:00.000Z"))).toBe("available");
    expect(desiredIdleStatus(availableNow, at("2026-11-06T04:00:00.000Z"))).toBe("available"); // Fri 06:00, still override
  });

  it("rolls Friday evening to Monday morning and leaves a disabled schedule alone", () => {
    const s = schedule();
    expect(nextBoundary(s, at("2026-11-06T17:00:00.000Z"))?.toISOString()).toBe("2026-11-09T05:00:00.000Z");
    expect(desiredIdleStatus(schedule({ enabled: false }), at("2026-11-05T08:00:00.000Z"))).toBeNull();
    expect(nextBoundary(schedule({ days: [] }), at("2026-11-05T08:00:00.000Z"))).toBeNull();
    expect(desiredIdleStatus(schedule({ days: [] }), at("2026-11-05T08:00:00.000Z"))).toBe("offline");
  });

  it("edits days without touching anyone else's template", () => {
    expect(toggleDay([1, 2, 3, 4, 5], 6)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(toggleDay([1, 2, 3, 4, 5], 1)).toEqual([2, 3, 4, 5]);
    expect(toggleDay([2, 3, 4], 2)).toEqual([3, 4]);
  });
});

describe("location upsert gate", () => {
  const base = {
    signedIn: true,
    trackingEnabled: true,
    status: "available",
    schedule: schedule(),
  };

  it("writes only while signed in, opted in, and Available inside the window", () => {
    const now = at("2026-11-05T08:00:00.000Z");
    expect(mayShareLocation(base, now)).toBe(true);
    expect(mayShareLocation({ ...base, signedIn: false }, now)).toBe(false);
    expect(mayShareLocation({ ...base, trackingEnabled: false }, now)).toBe(false);
    expect(mayShareLocation({ ...base, status: "offline" }, now)).toBe(false);
    expect(mayShareLocation({ ...base, status: "busy" }, now)).toBe(false);
    expect(mayShareLocation(base, at("2026-11-05T17:00:00.000Z"))).toBe(false); // Thu 19:00
    expect(mayShareLocation({ ...base, schedule: null }, at("2026-11-07T08:00:00.000Z"))).toBe(true);
    expect(mayShareLocation({
      ...base,
      schedule: schedule({ overrideStatus: "offline", overrideUntil: at("2026-11-05T16:00:00.000Z") }),
    }, now)).toBe(false);
  });
});
