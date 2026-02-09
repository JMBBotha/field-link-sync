import { describe, it, expect } from "vitest";
import {
  calculateDistanceKm,
  formatDistance,
  isWithinRadius,
  getDirection,
  getBroadcastRadiusForType,
  DEFAULT_BROADCAST_RADIUS,
} from "@/lib/geolocation";

describe("Geolocation Utilities", () => {
  it("calculates distance between Johannesburg and Pretoria (~58km)", () => {
    const dist = calculateDistanceKm(-26.2041, 28.0473, -25.7479, 28.2293);
    expect(dist).toBeGreaterThan(50);
    expect(dist).toBeLessThan(65);
  });

  it("returns 0km for same coordinates", () => {
    expect(calculateDistanceKm(-26.2, 28.0, -26.2, 28.0)).toBe(0);
  });

  it("formats distance correctly", () => {
    expect(formatDistance(0.5)).toBe("500m");
    expect(formatDistance(3.7)).toBe("3.7km");
    expect(formatDistance(42)).toBe("42km");
  });

  it("checks radius correctly", () => {
    // JHB to PTA is ~58km
    expect(isWithinRadius(-26.2041, 28.0473, -25.7479, 28.2293, 60)).toBe(true);
    expect(isWithinRadius(-26.2041, 28.0473, -25.7479, 28.2293, 50)).toBe(false);
  });

  it("returns correct compass directions", () => {
    // North: same lng, higher lat
    expect(getDirection(-26.2, 28.0, -25.0, 28.0)).toBe("N");
    // East: same lat, higher lng
    expect(getDirection(-26.2, 28.0, -26.2, 29.0)).toBe("E");
  });

  it("returns correct broadcast radius for service types", () => {
    expect(getBroadcastRadiusForType("Sales Visit", DEFAULT_BROADCAST_RADIUS)).toBe(30);
    expect(getBroadcastRadiusForType("AC Repair", DEFAULT_BROADCAST_RADIUS)).toBe(50);
    expect(getBroadcastRadiusForType("Consultation", DEFAULT_BROADCAST_RADIUS)).toBe(30);
    expect(getBroadcastRadiusForType("General", DEFAULT_BROADCAST_RADIUS)).toBe(40);
  });
});
