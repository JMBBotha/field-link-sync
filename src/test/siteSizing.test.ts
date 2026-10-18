import { describe, it, expect } from "vitest";
import { recommendBtu, sizeVerdict } from "@/lib/siteSizing";

describe("site sizing (sizing-and-install.md rules)", () => {
  it("bands", () => {
    expect(recommendBtu({ floorM2: 14 }).btu).toBe(9000);
    expect(recommendBtu({ floorM2: 20 }).btu).toBe(12000);
    expect(recommendBtu({ floorM2: 30 }).btu).toBe(18000);
    expect(recommendBtu({ floorM2: 45 }).btu).toBe(24000);
  });
  it("high ceiling scales area (20 m² at 3.2 m -> 18K)", () => {
    expect(recommendBtu({ floorM2: 20, ceilingM: 3.2 }).btu).toBe(18000);
    expect(recommendBtu({ floorM2: 20, ceilingM: 3.8 }).siteVisit).toBe(true);
  });
  it("one size up once for any factors", () => {
    expect(recommendBtu({ floorM2: 14, sun: true }).btu).toBe(12000);
    expect(recommendBtu({ floorM2: 14, sun: true, kitchen: true }).btu).toBe(12000);
  });
  it("verdict", () => {
    expect(sizeVerdict(12000, recommendBtu({ floorM2: 20 }))).toBe("ok");
    expect(sizeVerdict(9000, recommendBtu({ floorM2: 20 }))).toBe("too_small");
    expect(sizeVerdict(24000, recommendBtu({ floorM2: 10 }))).toBe("too_big");
    expect(sizeVerdict(null, recommendBtu({ floorM2: 10 }))).toBe("unknown");
  });
});
