import { describe, it, expect } from "vitest";
import { deriveSearchTags, productMatchesTerms } from "@/lib/productSearchTags";

describe("productSearchTags", () => {
  it("derives series, type and size tags", () => {
    const t = deriveSearchTags({ short_name: "Samsung AR6500 Wind-Free 4-Way Cassette 11.9k", btu_rating: 12000, kw: 3.5 }).split(" ");
    for (const w of ["windfree", "wind-free", "4-way", "cassette", "ar6500", "12000", "12k", "3.5kw"]) expect(t).toContain(w);
    expect(t).not.toContain("9k");
  });
  it("matches ignoring hyphens/spaces, all words required", () => {
    const p = { product_code: "X1", short_name: "Wind-Free 12k", brand: "Samsung", search_tags: "windfree 12000" };
    expect(productMatchesTerms(p, "windfree samsung")).toBe(true);
    expect(productMatchesTerms(p, "wind free 12000")).toBe(true);
    expect(productMatchesTerms(p, "windfree daikin")).toBe(false);
  });
});
