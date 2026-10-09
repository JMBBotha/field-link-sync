import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildSku, skuSegment, nextFreeSku, isValidSku, INHOUSE_CATEGORIES, suggestName, categoryByLabel } from "@/lib/inhouse/sku";
import { buildInhousePricebook, sortBookItems, unitLabel, fmtRand, type BookItem } from "@/lib/inhouse/pricebookPdf";
import { lengthLinePrice } from "@/lib/priceGuard";

describe("internal SKU scheme", () => {
  it("builds hierarchical, URL-safe codes", () => {
    expect(buildSku({ family: "ELC", type: "CAB", size: "2.5", variant: "3c" })).toBe("ELC-CAB-2.5-3C");
    expect(buildSku({ family: "ELC", type: "CON", size: "25mm" })).toBe("ELC-CON-25");
    expect(buildSku({ family: "CU", type: "SD", size: "1/4" })).toBe("CU-SD-1_4");
    expect(buildSku({ family: "FIX", type: "BOLT", size: "M10 x 50", variant: "galv" })).toBe("FIX-BOLT-M10X50-GALV");
    expect(buildSku({ family: "ELC", type: "CAB", size: "2,5 mm²" })).toBe("ELC-CAB-2.5");
    expect(buildSku({ family: "CSM", type: "GEN", size: "", variant: "" })).toBe("CSM-GEN");
    expect(skuSegment(' 1/2" ')).toBe("1_2IN");
    for (const c of ["ELC-CAB-2.5-3C", "CU-SD-1_4", "FIX-BOLT-M10X50"]) {
      expect(isValidSku(c)).toBe(true);
      expect(encodeURIComponent(c)).toBe(c);
    }
    expect(isValidSku("elc-cab")).toBe(false);
    expect(isValidSku("ELC--CAB")).toBe(false);
  });
  it("adds -2/-3 on a clash and keeps the item's own code when editing", () => {
    const taken = ["ELC-CON-25", "ELC-CON-25-2", "COPRL001"];
    expect(nextFreeSku("ELC-CON-25", taken)).toEqual({ code: "ELC-CON-25-3", clashed: true });
    expect(nextFreeSku("ELC-CON-20", taken)).toEqual({ code: "ELC-CON-20", clashed: false });
    expect(nextFreeSku("ELC-CON-25", taken, "ELC-CON-25")).toEqual({ code: "ELC-CON-25", clashed: false });
  });
  it("has Johan's four categories with family codes", () => {
    expect(INHOUSE_CATEGORIES.map((c) => c.label)).toEqual(["Electrical cable", "Electrical conduit", "Consumables", "Bolts & nuts"]);
    const cab = categoryByLabel("Electrical cable")!;
    expect(suggestName(cab, cab.types[0], "2.5", "3C")).toBe("Surfix / flat cable 2.5mm² 3C");
  });
});

const items: BookItem[] = [
  { key: "b", sku_code: "FIX-BOLT-M10X50", name: "Bolt M10 x 50 galv", category: "Bolts & nuts", cost: 4.2, per_metre: false },
  { key: "a", sku_code: "ELC-CAB-2.5-3C", name: "Surfix 2.5mm² 3C", category: "Electrical cable", cost: 1450, per_metre: true, unit_length: 100 },
];

describe("in-house price book PDF", () => {
  it("orders categories as Johan listed them", () => {
    expect(sortBookItems(items).map((i) => i.key)).toEqual(["a", "b"]);
    expect(unitLabel(items[1])).toBe("per m (100 m coil)");
    expect(fmtRand(1450)).toBe("R 1,450.00");
  });
  it("produces a valid PDF with exact, in-page row and price boxes", async () => {
    const r = await buildInhousePricebook(items, { version: 1, date: "9 Oct 2026" });
    const doc = await PDFDocument.load(r.bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(r.pageCount).toBe(1);
    for (const k of ["a", "b"]) {
      const l = r.layout[k];
      expect(l.page_number).toBe(1);
      for (const b of [l.row_bbox, l.price_bbox]) {
        expect(b.x).toBeGreaterThanOrEqual(0); expect(b.y).toBeGreaterThan(0.05);
        expect(b.x + b.width).toBeLessThanOrEqual(1); expect(b.y + b.height).toBeLessThanOrEqual(1);
      }
      expect(l.price_bbox.x).toBeGreaterThanOrEqual(r.priceColumn.x_frac - 0.001);
    }
    expect(r.layout.b.row_bbox.y).toBeGreaterThan(r.layout.a.row_bbox.y);
  });
  it("paginates long lists and keeps every item on a page", async () => {
    const many: BookItem[] = Array.from({ length: 95 }, (_, i) => ({ key: `k${i}`, sku_code: `CSM-GEN-${i}`, name: `Item ${i}`, category: "Consumables", cost: 10 + i, per_metre: false }));
    const r = await buildInhousePricebook(many, { version: 2, date: "x" });
    expect(r.pageCount).toBeGreaterThan(2);
    expect(Object.keys(r.layout)).toHaveLength(95);
    expect(Math.max(...Object.values(r.layout).map((l) => l.page_number))).toBe(r.pageCount);
  });
  it("renders an empty book", async () => {
    const r = await buildInhousePricebook([], { version: 3, date: "x" });
    expect(r.pageCount).toBe(1);
  });
});

describe("per-metre pricing reuses the One Stop Shop length maths", () => {
  it("(coil cost / length) x 1.10 waste x markup", () => {
    const p: any = { cost_price: 1450, cost_excl_vat: 1450, sold_in_length: true, unit_length: 100, default_markup_percent: 100, price_per_metre: 14.5 };
    const lp = lengthLinePrice(p, 10, 100);
    expect(lp.costPerM).toBeCloseTo(15.95, 2);
    expect(lp.sellPerM).toBeCloseTo(31.9, 2);
  });
});
