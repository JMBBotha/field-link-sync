import { describe, it, expect } from "vitest";
import { canSeePriceListPdfs, priceListCandidates, priceListLabel } from "@/lib/priceListPdf";

const row = { id: "1", supplier_id: "s1", file_name: "Samsung 2026.pdf", brand: "Samsung", file_path: "s1/Samsung 2026.pdf", storage_path: null, file_url: "https://x.supabase.co/storage/v1/object/public/price-lists/a%20b.pdf", price_list_type: null };

describe("price list pdf", () => {
  it("admin only", () => {
    expect(canSeePriceListPdfs(["admin"])).toBe(true);
    expect(canSeePriceListPdfs(["dispatcher"])).toBe(false);
    expect(canSeePriceListPdfs(["field_agent"])).toBe(false);
    expect(canSeePriceListPdfs([])).toBe(false);
  });
  it("candidates use storage paths, deduped", () => {
    const c = priceListCandidates(row);
    expect(c[0]).toEqual({ bucket: "supplier-pdf-pages", path: "s1/Samsung 2026.pdf" });
    expect(c).toContainEqual({ bucket: "price-lists", path: "a b.pdf" });
    expect(new Set(c.map((x) => x.bucket + x.path)).size).toBe(c.length);
  });
  it("label", () => { expect(priceListLabel(row, "Samsung")).toBe("Samsung · Samsung 2026"); });
});

import { priceListViewerSrc } from "@/lib/priceListPdf";
describe("priceListViewerSrc", () => {
  it("hides thumbnails and fits width", () => {
    expect(priceListViewerSrc("blob:x/1")).toBe("blob:x/1#pagemode=none&navpanes=0&view=FitH");
    expect(priceListViewerSrc("blob:x/1#page=2")).toBe("blob:x/1#pagemode=none&navpanes=0&view=FitH");
  });
});
