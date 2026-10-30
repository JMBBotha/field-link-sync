import { describe, it, expect } from "vitest";
import { etaMinutes, friendlyAgo, mapUrl, sastTime, techStatusLabel } from "@/lib/techLocation";
const t = { tech_id: "a", name: "X", lat: -33.9, lng: 18.6, last_updated: null, distance_km: 4, status: "on_the_way" as const, shared: true };
describe("tech location helpers", () => {
  it("labels", () => {
    expect(techStatusLabel(t)).toBe("On the way");
    expect(techStatusLabel({ ...t, shared: false })).toBe("Location not shared");
  });
  it("ago/eta/time", () => {
    expect(friendlyAgo(new Date(Date.now() - 5 * 60000).toISOString())).toBe("5 min ago");
    expect(etaMinutes(4)).toBe(5);
    expect(etaMinutes(20)).toBe(30);
    expect(sastTime("2026-10-30T06:00:00Z")).toBe("08:00");
  });
  it("map url has both pins", () => {
    expect(mapUrl(t, -33.8, 18.7)).toContain("origin=-33.9,18.6&destination=-33.8,18.7");
    expect(mapUrl({ ...t, lat: null }, 1, 2)).toBeNull();
  });
});
import { presenceLabel } from "@/lib/techLocation";
describe("presence labels", () => {
  it("check-in/out", () => {
    expect(presenceLabel({ kind: "job", title: "", distance_m: 1, arrived_at: "2026-10-30T07:00:00Z" })).toBe("Checked in 09:00");
    expect(presenceLabel({ kind: "sales_visit", title: "", distance_m: 1, en_route_at: "x" })).toBe("On the way");
    expect(techStatusLabel({ ...t, shared: false, status: "left_site", arrived_at: "x" })).toBe("Left site");
  });
});
