import { describe, it, expect } from "vitest";
import { rubber } from "./rubberBand";
describe("rubber", () => {
  it("is zero at rest, sign-preserving, and capped", () => {
    expect(rubber(0)).toBe(0);
    expect(rubber(100)).toBeGreaterThan(0);
    expect(rubber(-100)).toBeLessThan(0);
    expect(rubber(100000)).toBeLessThanOrEqual(72);
    expect(rubber(50)).toBeLessThan(50);
  });
});
