import { describe, expect, it } from "vitest";
import { packTermsColumns } from "./termsColumnPack";

describe("packTermsColumns", () => {
  it("fills the left column before the right, and does not leave a full column empty", () => {
    const heights = Array.from({ length: 20 }, () => 10);
    const pages = packTermsColumns(heights, 100, 100);
    expect(pages.length).toBe(1);
    expect(pages[0].left).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(pages[0].right).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(pages[0].breakBefore).toBe(false);
  });

  it("starts a new page once both columns are full, and only the last column may end early", () => {
    const heights = Array.from({ length: 25 }, () => 10);
    const pages = packTermsColumns(heights, 100, 100);
    expect(pages).toHaveLength(2);
    expect(pages[0].left).toHaveLength(10);
    expect(pages[0].right).toHaveLength(10);
    expect(pages[1].breakBefore).toBe(true);
    expect(pages[1].left).toEqual([20, 21, 22, 23, 24]);
    expect(pages[1].right).toEqual([]);
    for (const page of pages.slice(0, -1)) {
      const left = page.left.reduce((s, i) => s + heights[i], 0);
      const right = page.right.reduce((s, i) => s + heights[i], 0);
      expect(100 - left).toBeLessThan(10);
      expect(100 - right).toBeLessThan(10);
    }
  });

  it("uses the shorter first page, then full pages", () => {
    const heights = Array.from({ length: 10 }, () => 20);
    const pages = packTermsColumns(heights, 40, 100);
    expect(pages[0].breakBefore).toBe(false);
    expect(pages[0].left).toEqual([0, 1]);
    expect(pages[0].right).toEqual([2, 3]);
    expect(pages[1].left.length).toBe(5);
    expect(pages[1].right).toEqual([9]);
  });
});
