import { describe, it, expect } from "vitest";
import { groupBrandCounts } from "@/components/suppliers/SupplierBrandCounts";
describe("supplier brand counts", () => {
  it("splits by brand and category, shows live-book brands with 0", () => {
    const r = groupBrandCounts([
      { brand: "Samsung", product_category: "Air Conditioning", category: null },
      { brand: "samsung", product_category: null, category: "Heat pumps" },
      { brand: null, product_category: null, category: null },
    ], ["Comfee", "Samsung"]);
    expect(r.map((x) => [x.brand, x.total])).toEqual([["Samsung", 2], ["No brand", 1], ["Comfee", 0]]);
    expect(r[0].categories).toHaveLength(2);
  });
});
