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

describe("computePageCuts forced breaks (invoice closing page, Johan 14 Oct)", () => {
  it("starts a new page at a forced break even when the content would fit", () => {
    expect(computePageCuts(() => false, 500, 1000, undefined, [300])).toEqual([300, 500]);
  });
  it("combines forced breaks with normal pagination", () => {
    const cuts = computePageCuts(() => false, 2500, 1000, 0, [400]);
    expect(cuts[0]).toBe(400);
    expect(cuts[cuts.length - 1]).toBe(2500);
    cuts.reduce((prev, c) => { expect(c - prev).toBeLessThanOrEqual(1000); return c; }, 0);
  });
});

describe("computePageCuts keep ranges + forced-break snapping (Johan 14 Oct)", () => {
  it("never cuts inside a keep range (totals table)", () => {
    const cuts = computePageCuts(() => true, 3000, 1000, undefined, [], 1, [[700, 1100]]);
    expect(cuts.some((c) => c > 700 && c < 1100)).toBe(false);
  });
  it("skips a forced break that would leave a near-empty page", () => {
    const cuts = computePageCuts(() => false, 1500, 1000, 0, [1050]);
    expect(cuts).toEqual([1000, 1500]);
  });
});

describe("side-by-side keep blocks (invoice terms points, Johan 2 Nov 21:10)", () => {
  it("moves up out of every keep it lands in, without cascading to the top of the page", () => {
    // two columns of points with aligned gaps near 900; ideal cut 1000 (pageRows 1000)
    const keep: [number, number][] = [[800, 900], [905, 1010], [850, 898], [902, 1050]];
    const cuts = computePageCuts(() => false, 3000, 1000, 0, [], 8, keep);
    expect(cuts[0]).toBe(901);
    expect(keep.some(([a, b]) => a < cuts[0] && cuts[0] < b)).toBe(false);
  });
});

describe("quote terms pagination (Q-2026-0053)", () => {
  it("staggered full-height columns leave a short page; aligned rows fill it", () => {
    // Two columns whose section keeps do not share edges. The ideal cut is inside a keep
    // that starts below the top fifth of the page, so the cutter walks up and the page
    // holds only the short block above that keep.
    const columns: [number, number][] = [[0, 150], [250, 900], [0, 140], [220, 1200]];
    const sparse = computePageCuts(() => false, 3000, 1000, 0, [], 1, columns);
    expect(sparse[0]).toBeLessThan(400);
    expect(columns.some(([a, b]) => a < sparse[0] && sparse[0] < b)).toBe(false);

    // The same page height with row-aligned keeps (01|02, then 03|04, …) cuts in the gap
    // near the bottom of the page instead of abandoning the rest of it.
    const rows: [number, number][] = [
      [0, 150], [260, 700], [740, 980],
      [0, 150], [260, 720], [740, 990],
      [1020, 1400], [1020, 1500],
    ];
    const filled = computePageCuts(() => false, 3000, 1000, 0, [], 1, rows);
    expect(filled[0]).toBeGreaterThanOrEqual(900);
    expect(rows.some(([a, b]) => a < filled[0] && filled[0] < b)).toBe(false);
  });
});
