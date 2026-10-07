import { describe, it, expect } from "vitest";
import { normModel, pickActiveSpecial, specialLineMeta, type SupplierSpecial } from "@/lib/specials";

const sp = (o: Partial<SupplierSpecial>): SupplierSpecial => ({
  id: "s1", supplier_id: null, model_number: "FTXM25R", supplier_product_id: null, special_cost: 5000,
  start_date: "2026-10-01", end_date: "2026-10-31", specials_pdf_path: null, notes: null, is_active: true, ...o,
});

describe("specials overlay", () => {
  it("normalises model numbers", () => expect(normModel(" ftxm-25 r ")).toBe("ftxm25r"));
  it("matches by model inside the date window only", () => {
    expect(pickActiveSpecial([sp({})], { modelNumber: "FTXM 25R" }, "2026-10-07")?.id).toBe("s1");
    expect(pickActiveSpecial([sp({})], { modelNumber: "FTXM25R" }, "2026-11-01")).toBeNull();
    expect(pickActiveSpecial([sp({ is_active: false })], { modelNumber: "FTXM25R" }, "2026-10-07")).toBeNull();
  });
  it("matches by product id and picks the cheapest", () => {
    const list = [sp({ id: "a", supplier_product_id: "p", special_cost: 6000 }), sp({ id: "b", supplier_product_id: "p", special_cost: 5500, model_number: "X" })];
    expect(pickActiveSpecial(list, { productId: "p" }, "2026-10-07")?.id).toBe("b");
  });
  it("stamps line-only metadata", () => {
    expect(specialLineMeta(sp({}), 6200)).toMatchObject({ price_overridden: true, special: { cost: 5000, normal_cost: 6200, end_date: "2026-10-31" } });
  });
});
