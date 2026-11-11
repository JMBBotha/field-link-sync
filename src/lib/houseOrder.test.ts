import { describe, expect, it } from "vitest";
import { compareHouseLabels, sortHouseLabels } from "./houseOrder";

const label = (s: string | null) => s;

describe("sortHouseLabels", () => {
  it("puts the Book a job house list in natural numeric order", () => {
    const stored = ["House 54", "House 55", "House 4", "House 8", "House 21", "House 22", "House 1", "House 6"];
    expect(sortHouseLabels(stored, label)).toEqual([
      "House 1", "House 4", "House 6", "House 8", "House 21", "House 22", "House 54", "House 55",
    ]);
  });

  it("orders bare numbers, suffixes, other prefixes, and leaves unnumbered last", () => {
    const stored = ["Unit 12", "4A", "House 4", "4", null, "", "Clubhouse", "10", "Unit 2", "House 10", "4B"];
    expect(sortHouseLabels(stored, label)).toEqual([
      "Unit 2", "4", "4A", "4B", "House 4", "10", "House 10", "Unit 12", null, "", "Clubhouse",
    ]);
  });

  it("does not mutate the source list", () => {
    const stored = ["House 10", "House 2"];
    sortHouseLabels(stored, label);
    expect(stored).toEqual(["House 10", "House 2"]);
  });

  it("treats a blank and a null as the same unnumbered label", () => {
    expect(compareHouseLabels(null, "  ")).toBe(0);
    expect(compareHouseLabels("House 1", null)).toBeLessThan(0);
    expect(compareHouseLabels(undefined, "4A")).toBeGreaterThan(0);
  });
});
