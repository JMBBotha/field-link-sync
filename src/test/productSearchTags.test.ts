import { describe, it, expect } from "vitest";
import { deriveSearchTags, kitCodeParts, productMatchesTerms } from "@/lib/productSearchTags";
import { searchAndRankProducts } from "@/components/catalog/searchSynonyms";

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

  it("matches a Livance coastal kit by lcac, coastal and each plus-separated part code", () => {
    const code = "R32-MICAS-12 + CST-R32-MICOND-12 + BZE-T-MBQ4-03";
    expect(kitCodeParts(code)).toEqual(["R32-MICAS-12", "CST-R32-MICOND-12", "BZE-T-MBQ4-03"]);
    const tags = deriveSearchTags({
      product_code: code,
      short_name: "Midea 12K INV Cassette",
      category: "Cassette Inverter",
    });
    for (const w of ["lcac", "coastal", "cassette", "r32-micas-12", "cst-r32-micond-12", "bze-t-mbq4-03"]) {
      expect(tags.split(" ")).toContain(w);
    }
    const kit = { product_code: code, short_name: "Midea 12K INV Cassette", brand: "Midea", search_tags: tags };
    const other = { product_code: "AR12", short_name: "Samsung midwall", brand: "Samsung", search_tags: "wall" };
    for (const q of ["lcac", "coastal", "R32-MICAS-12", "CST-R32-MICOND-12", "BZE-T-MBQ4-03"]) {
      expect(productMatchesTerms(kit, q)).toBe(true);
      expect(searchAndRankProducts(q, [other, kit])[0]?.product_code).toBe(code);
    }
    // A part code, and the series words, match even before search_tags are backfilled.
    const bare = { product_code: code, short_name: "Midea 12K INV Cassette" };
    expect(productMatchesTerms(bare, "CST-R32-MICOND-12")).toBe(true);
    expect(productMatchesTerms(bare, "lcac")).toBe(true);
    expect(productMatchesTerms(bare, "coastal")).toBe(true);
    const plainCassette = { product_code: "R32-MICAS-12 + R32-MICOND-12 + BZE-T-MBQ4-03", short_name: "Midea 12K INV Cassette" };
    expect(deriveSearchTags(plainCassette).split(" ")).not.toContain("coastal");
    expect(productMatchesTerms(plainCassette, "coastal")).toBe(false);
    expect(productMatchesTerms(plainCassette, "R32-MICAS-12")).toBe(true);
  });
});
