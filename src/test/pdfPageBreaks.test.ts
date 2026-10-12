import { describe, it, expect } from "vitest";
import { computePageCuts, isUniformRow } from "@/lib/pdfPageBreaks";

describe("computePageCuts", () => {
  // Text lines occupy rows [10k+2, 10k+8); rows 10k..10k+1 and 10k+8..10k+9 are gaps.
  const quiet = (y: number) => y % 10 < 2 || y % 10 >= 8;
  it("never cuts inside a text line", () => {
    const cuts = computePageCuts(quiet, 1000, 95);
    expect(cuts[cuts.length - 1]).toBe(1000);
    for (const c of cuts.slice(0, -1)) expect(quiet(c) || quiet(c - 1)).toBe(true);
    for (let i = 1; i < cuts.length; i++) expect(cuts[i] - cuts[i - 1]).toBeLessThanOrEqual(95);
  });
  it("falls back to a hard cut when there is no gap", () => {
    expect(computePageCuts(() => false, 250, 100)).toEqual([100, 200, 250]);
  });
  it("single page needs no cut", () => {
    expect(computePageCuts(quiet, 80, 100)).toEqual([80]);
  });
});

describe("isUniformRow", () => {
  it("detects blank vs text rows", () => {
    const w = 4;
    const d = new Uint8ClampedArray(w * 2 * 4).fill(255);
    d[(w + 2) * 4] = 0; d[(w + 2) * 4 + 1] = 0; d[(w + 2) * 4 + 2] = 0;
    expect(isUniformRow(d, w, 0, 10, 1)).toBe(true);
    expect(isUniformRow(d, w, 1, 10, 1)).toBe(false);
  });
});
