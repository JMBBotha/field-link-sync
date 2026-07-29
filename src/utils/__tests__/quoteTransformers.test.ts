import { describe, it, expect } from "vitest";
import {
  computeItemsSubtotal,
  computeQuoteTotals,
  QUOTE_VAT_RATE,
} from "../quoteTransformers";
import type { QuoteArea, QuoteItem } from "@/types/quote";

/** Test factories keep specs terse while satisfying the full QuoteItem shape. */
const area = (id: string, name = id, sort_order = 0): QuoteArea => ({
  id,
  quote_id: "q1",
  name,
  sort_order,
  created_at: "",
  updated_at: "",
});

const item = (overrides: Partial<QuoteItem> = {}): QuoteItem => ({
  id: Math.random().toString(36).slice(2),
  quote_id: "q1",
  area_id: null,
  parent_item_id: null,
  product_id: null,
  item_name: "Item",
  item_number: null,
  description: null,
  quantity: 1,
  length: null,
  unit_price: 0,
  total_price: null,
  is_bundle: false,
  item_type: null,
  metadata: {},
  sort_order: 0,
  notes: null,
  source: "manual",
  supplier: null,
  created_at: "",
  updated_at: "",
  ...overrides,
});

describe("computeItemsSubtotal", () => {
  it("sums total_price when present, falling back to unit_price * quantity", () => {
    const items = [
      item({ unit_price: 100, quantity: 2, total_price: null }), // 200
      item({ unit_price: 50, quantity: 3, total_price: 175 }),   // 175 (override)
    ];
    expect(computeItemsSubtotal(items)).toBe(375);
  });

  it("excludes bundle children (parent_item_id set)", () => {
    const items = [
      item({ id: "p", unit_price: 1000, quantity: 1 }),
      item({ id: "c", parent_item_id: "p", unit_price: 999, quantity: 1 }),
    ];
    expect(computeItemsSubtotal(items)).toBe(1000);
  });

  it("excludes legacy_placeholder rows", () => {
    const items = [
      item({ unit_price: 500, quantity: 1 }),
      item({ unit_price: 9_999, quantity: 1, source: "legacy_placeholder" }),
    ];
    expect(computeItemsSubtotal(items)).toBe(500);
  });

  it("returns 0 for empty arrays", () => {
    expect(computeItemsSubtotal([])).toBe(0);
  });
});

describe("computeQuoteTotals", () => {
  it("derives subtotal, VAT (15%), and total from shared items", () => {
    const items = [
      item({ area_id: "a1", unit_price: 100, quantity: 2 }), // 200
      item({ area_id: "a1", total_price: 800 }),             // 800
    ];
    const totals = computeQuoteTotals(items, [area("a1")]);
    expect(totals.subtotal).toBe(1000);
    expect(totals.vatAmount).toBeCloseTo(150, 6);
    expect(totals.total).toBeCloseTo(1150, 6);
    expect(QUOTE_VAT_RATE).toBe(0.15);
  });

  it("counts only real top-level items", () => {
    const items = [
      item({ id: "p", area_id: "a1", unit_price: 100, quantity: 1 }),
      item({ id: "c", parent_item_id: "p", unit_price: 50, quantity: 1 }),
      item({ area_id: "a1", source: "legacy_placeholder", unit_price: 999 }),
    ];
    const totals = computeQuoteTotals(items, [area("a1")]);
    expect(totals.itemCount).toBe(1);
    expect(totals.subtotal).toBe(100);
  });

  it("excludes zero-value non-placeholder scaffolding rows", () => {
    const items = [
      item({ area_id: "a1", source: "manual", quantity: 0, unit_price: 0, total_price: 0 }),
      item({ area_id: "a1", source: "manual", quantity: 1, unit_price: 100 }),
    ];
    const totals = computeQuoteTotals(items, [area("a1")]);
    expect(totals.itemCount).toBe(1);
    expect(totals.subtotal).toBe(100);
  });

  it("zoneCount reflects only areas that hold real items", () => {
    const items = [
      item({ area_id: "a1", unit_price: 100, quantity: 1 }),
      // a2 exists but empty → not counted
      item({ area_id: "a3", source: "legacy_placeholder", unit_price: 500 }),
    ];
    const totals = computeQuoteTotals(items, [area("a1"), area("a2"), area("a3")]);
    expect(totals.zoneCount).toBe(1);
  });

  it("groups items without an area under a synthetic unassigned zone", () => {
    const items = [
      item({ area_id: null, unit_price: 100, quantity: 1 }),
      item({ area_id: "missing", unit_price: 100, quantity: 1 }),
      item({ area_id: "a1", unit_price: 100, quantity: 1 }),
    ];
    const totals = computeQuoteTotals(items, [area("a1")]);
    // a1 + unassigned
    expect(totals.zoneCount).toBe(2);
    expect(totals.itemCount).toBe(3);
    expect(totals.subtotal).toBe(300);
  });

  it("avgMarkup averages metadata.markup_percent across items with a positive value", () => {
    const items = [
      item({ unit_price: 100, quantity: 1, metadata: { markup_percent: 20 } }),
      item({ unit_price: 100, quantity: 1, metadata: { markup_percent: 40 } }),
      item({ unit_price: 100, quantity: 1, metadata: { markup_percent: 0 } }), // excluded
      item({ unit_price: 100, quantity: 1, metadata: {} }),                    // excluded
    ];
    const totals = computeQuoteTotals(items, []);
    expect(totals.avgMarkup).toBe(30);
  });

  it("avgMarkup is 0 when no items carry a markup", () => {
    const items = [item({ unit_price: 100, quantity: 1 })];
    expect(computeQuoteTotals(items, []).avgMarkup).toBe(0);
  });

  it("returns zeros for an empty quote", () => {
    const totals = computeQuoteTotals([], []);
    expect(totals).toEqual({
      itemCount: 0,
      zoneCount: 0,
      subtotal: 0,
      vatAmount: 0,
      total: 0,
      avgMarkup: 0,
    });
  });

  it("respects a custom VAT rate override", () => {
    const items = [item({ unit_price: 200, quantity: 1 })];
    const totals = computeQuoteTotals(items, [], 0);
    expect(totals.vatAmount).toBe(0);
    expect(totals.total).toBe(200);
  });

  it("never mutates the input arrays", () => {
    const items = [item({ area_id: "a1", unit_price: 100, quantity: 1 })];
    const areas = [area("a1")];
    const itemsSnap = JSON.stringify(items);
    const areasSnap = JSON.stringify(areas);
    computeQuoteTotals(items, areas);
    expect(JSON.stringify(items)).toBe(itemsSnap);
    expect(JSON.stringify(areas)).toBe(areasSnap);
  });
});
