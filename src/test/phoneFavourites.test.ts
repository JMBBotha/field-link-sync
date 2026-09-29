import { describe, it, expect, afterEach, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { isPhoneViewport } from "@/hooks/useIsPhone";
import { groupFavourites, planFavouriteToggle } from "@/hooks/useQuoteFavourites";
import { addCatalogProductToQuote } from "@/lib/mandy/quoteOps";
import { setActiveQuoteMarkupRates } from "@/lib/pricing";

const mk = (code: string, name: string, cost: number, extra: Record<string, unknown> = {}) => ({
  id: code, product_code: code, short_name: name, brand: "Samsung", product_category: "Air Conditioning",
  category: "Air Conditioning", cost_price: cost, cost_excl_vat: cost, default_markup_percent: 25, markup_percent: 25,
  supplier_name: "Samsung", supplier_type: "ac_units", description: "", ...extra,
}) as any;

const unit = mk("AR24", "Samsung 24K INV MW", 14260.176);
const bracket = mk("BRK1", "Wall bracket", 200, { product_category: "Consumables", category: "Consumables", default_markup_percent: 100, markup_percent: 100 });
const comp = (code: string, cost: number, ppm: number, len: number) => ({
  quantity: 1, length_metres: 1, is_length_item: true, is_optional: false,
  product: { id: code, product_code: code, short_name: code, product_category: "Consumables", category: "Consumables",
    cost_price: cost, cost_excl_vat: cost, price_per_metre: ppm, sold_in_length: true, unit_length: len, default_markup_percent: 100 },
});
const kit = { id: "k1", name: "24K INV 3/8 & 5/8 PIPING KIT", items: [comp("COPRL004", 2163.06, 141.93, 15.24), comp("COPRL002", 1265.44, 83.03, 15.24)] };
const template = {
  id: "t1", name: "24K", min_btu: 20000, max_btu: 26000, is_active: true, sort_order: 1,
  items: [
    { role: "piping_kit", included: true, default_length_m: 3 },
    { role: "bracket", included: true, product_code: "BRK1", default_qty: 1 },
  ],
} as any;

afterEach(() => setActiveQuoteMarkupRates(null));

describe("isPhoneViewport", () => {
  it("phone portrait and landscape with touch", () => {
    expect(isPhoneViewport(390, 844, true)).toBe(true);
    expect(isPhoneViewport(844, 390, true)).toBe(true);
  });
  it("tablet 800x1280 is not a phone", () => expect(isPhoneViewport(800, 1280, true)).toBe(false));
  it("desktop without touch is not a phone", () => {
    expect(isPhoneViewport(1440, 900, false)).toBe(false);
    expect(isPhoneViewport(500, 500, false)).toBe(false);
  });
});

describe("groupFavourites", () => {
  it("splits units/materials/services and counts archived favourites", () => {
    const svc = [{ id: "s1", name: "Service", is_active: true } as any];
    const g = groupFavourites(["AR24", "BRK1", "gone"], [unit, bracket], svc);
    expect(g.units.map((p) => p.id)).toEqual(["AR24"]);
    expect(g.materials.map((p) => p.id)).toEqual(["BRK1"]);
    expect(g.services).toHaveLength(1);
    expect(g.hiddenCount).toBe(1);
  });
});

describe("planFavouriteToggle", () => {
  it("first toggle from shared seeds the shared set, then adds", () => {
    const p = planFavouriteToggle("shared", ["a", "b"], "c");
    expect(p.adding).toBe(true);
    expect(p.inserts.sort()).toEqual(["a", "b", "c"]);
    expect([...p.next].sort()).toEqual(["a", "b", "c"]);
  });
  it("un-starring a shared favourite seeds the others only", () => {
    const p = planFavouriteToggle("shared", ["a", "b"], "a");
    expect(p.inserts).toEqual(["b"]);
    expect(p.deletes).toEqual([]);
    expect([...p.next]).toEqual(["b"]);
  });
  it("personal toggles just insert or delete", () => {
    expect(planFavouriteToggle("personal", ["a"], "b").inserts).toEqual(["b"]);
    expect(planFavouriteToggle("personal", ["a"], "a").deletes).toEqual(["a"]);
  });
});

describe("same favourite twice", () => {
  it("adds two full sets with identical prices", async () => {
    setActiveQuoteMarkupRates({ units: 25, materials: 100 } as any);
    const rows: any[] = [];
    const addItem = async (i: any) => { const r = { ...i, id: `row${rows.length}` }; rows.push(r); return r; };
    const opts = { addItem: addItem as any, product: unit, areaId: "a1", bundles: [kit] as any, templates: [template], liveProducts: [unit, bracket] };
    const a = await addCatalogProductToQuote({ ...opts, sortOrder: 0 });
    const b = await addCatalogProductToQuote({ ...opts, sortOrder: 10 });
    const units = rows.filter((r) => r.product_id === "AR24");
    expect(units).toHaveLength(2);
    expect(units[0].unit_price).toBe(units[1].unit_price);
    const setA = rows.filter((r) => r.metadata?.install?.unit_item_id === a.line!.id);
    const setB = rows.filter((r) => r.metadata?.install?.unit_item_id === b.line!.id);
    expect(setA.length).toBe(2);
    expect(setB.length).toBe(2);
    expect(setA.map((r) => r.unit_price)).toEqual(setB.map((r) => r.unit_price));
  });
});
