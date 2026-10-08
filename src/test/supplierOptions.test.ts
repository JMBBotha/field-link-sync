import { describe, it, expect } from "vitest";
import { buildSupplierOptions, countLivePages, resolveSavedSupplier } from "@/components/catalog/quote-builder/supplierOptions";

describe("price list supplier options", () => {
  const rows = [
    { supplier_id: "s1", pdf_upload_id: "u1", pdf_filename: "a.pdf", page_number: 1 },
    { supplier_id: "s1", pdf_upload_id: "u1", pdf_filename: "a.pdf", page_number: 1 }, // dup
    { supplier_id: "s1", pdf_upload_id: null, pdf_filename: "a.pdf", page_number: 2 },
    { supplier_id: "s2", pdf_upload_id: "u2", pdf_filename: "b.pdf", page_number: 1 },
    { supplier_id: "s3", pdf_upload_id: "dead", pdf_filename: "c.pdf", page_number: 1 },
  ];
  const counts = countLivePages(rows, new Set(["dead"]));
  const opts = buildSupplierOptions(["s1", "s2", "s3"], { s1: "  SAMSUNG AIR ", s2: "ALPHA", s3: "ZETA" }, counts);
  it("trims, sorts A-Z, counts live pages, hides 0-page suppliers", () => {
    expect(counts).toEqual({ s1: 2, s2: 1 });
    expect(opts).toEqual([{ value: "s2", label: "ALPHA", count: 1 }, { value: "s1", label: "SAMSUNG AIR", count: 2 }]);
  });
  it("saved value not in list falls back to all", () => {
    expect(resolveSavedSupplier("s3", opts)).toBe("all");
    expect(resolveSavedSupplier("s1", opts)).toBe("s1");
    expect(resolveSavedSupplier(null, opts)).toBe("all");
  });
});
