import { describe, it, expect, afterEach } from "vitest";
import { addCatalogProductToQuote, matchSpokenProduct, kitLengthPatch } from "@/lib/mandy/quoteOps";
import { setActiveQuoteMarkupRates } from "@/lib/pricing";

const mk = (code: string, name: string, cost: number, extra: Record<string, unknown> = {}) => ({
  id: code, product_code: code, short_name: name, brand: "Samsung", product_category: "Air Conditioning",
  category: "Air Conditioning", cost_price: cost, cost_excl_vat: cost, default_markup_percent: 25, markup_percent: 25,
  supplier_name: "Samsung", supplier_type: "ac_units", description: "", ...extra,
}) as any;

const samsung = [
  mk("AR24BSAAAWK/FA", "Samsung 24K INV MW", 21355.824),
  mk("AR24BSHCMWK/FA", "Samsung 24K INV MW", 15512.344),
  mk("AR40F24C0AG/FA", "Samsung 24K INV MW", 14260.176),
];

const comp = (code: string, name: string, cost: number, ppm: number, len: number) => ({
  quantity: 1, length_metres: 1, is_length_item: true, is_optional: false,
  product: { id: code, product_code: code, short_name: name, product_category: "Consumables", category: "Consumables",
    cost_price: cost, cost_excl_vat: cost, price_per_metre: ppm, sold_in_length: true, unit_length: len, default_markup_percent: 100, supplier_name: "One Stop" },
});
const kit = {
  id: "6b62cd9f-57b9-4c88-8bf3-f50164b1b139", name: "24K INV 3/8 & 5/8 PIPING KIT COPPER LASSO ISO CABLE TIES ONLY",
  items: [
    comp("COPRL004", "Soft Drawn Copper 5/8", 2163.06, 141.93, 15.24),
    comp("COPRL002", "Soft Drawn Copper 3/8", 1265.44, 83.03, 15.24),
    comp("IT010", "Arma Flex 3/8", 15.46, 8.59, 1.8),
    comp("IT012", "Arma Flex 5/8", 19.78, 10.99, 1.8),
    comp("TAPE006", "Lasso Tape 48mm", 64.28, 2.14, 30),
  ],
};

afterEach(() => setActiveQuoteMarkupRates(null));

describe("Mandy add_item_to_area uses the palette path", () => {
  it("near-tie on 'Samsung 24000 inverter' → chips, never a guess", () => {
    const m = matchSpokenProduct("a Samsung 24000 inverter", samsung);
    expect(m.tie).toBe(true);
    expect(m.ranked.length).toBe(3);
  });

  it("AR40F24C0AG/FA sells R17 825,22 and auto-adds a 1 m kit ≈ R493", async () => {
    setActiveQuoteMarkupRates({ units: 25, materials: 100 } as any);
    const rows: any[] = [];
    const addItem = async (i: any) => { const r = { ...i, id: `row${rows.length}` }; rows.push(r); return r; };
    const r = await addCatalogProductToQuote({ addItem: addItem as any, product: samsung[2], areaId: "a1", sortOrder: 0, bundles: [kit] });
    expect(rows[0].unit_price).toBeCloseTo(17825.22, 2);
    expect(rows[0].metadata.cost_excl).toBeCloseTo(14260.18, 2);
    expect(rows[0].metadata.markup_percent).toBe(25);
    expect(rows[1].is_bundle).toBe(true);
    expect(rows[1].length).toBe(1);
    expect(rows[1].unit_price).toBeGreaterThan(490);
    expect(rows[1].unit_price).toBeLessThan(496);
    expect(r.kitName).toContain("24K");
    const p = kitLengthPatch(rows[1], 3);
    expect(p.unit_price).toBeCloseTo(rows[1].unit_price * 3, 1);
    console.log("ROWS", JSON.stringify(rows.map((x) => ({ n: x.item_name, q: x.quantity, len: x.length, up: x.unit_price, meta: { c: x.metadata.cost_excl, m: x.metadata.markup_percent } }))));
  });
});
