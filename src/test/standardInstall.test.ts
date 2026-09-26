import { describe, it, expect, afterEach } from "vitest";
import { addCatalogProductToQuote, catalogLineFields } from "@/lib/mandy/quoteOps";
import { pickInstallTemplate, lengthLabel, type InstallTemplate } from "@/lib/installTemplates";
import { setActiveQuoteMarkupRates } from "@/lib/pricing";

afterEach(() => setActiveQuoteMarkupRates(null));

const c = (code: string, name: string, cost: number, extra: Record<string, unknown> = {}) => ({
  id: code, product_code: code, short_name: name, product_category: "Consumables", category: "Consumables",
  cost_price: cost, cost_excl_vat: cost, default_markup_percent: 100, supplier_name: "ONE STOP SHOP ", ...extra,
}) as any;
export const LIVE = [
  c("BRAC01", "Bracket 450", 210), c("BRAC02", "Bracket 550", 225), c("BRAC05", "Bracket 650", 275),
  c("BRAC14", "Flatback 450", 315), c("BRAC15", "Flatback 550", 335),
  c("TRUNK01", "PVC Trunking 100 x 40 x 3mtr", 132.25, { sold_in_length: true, unit_length: 3, price_per_metre: 44.08 }),
  c("TRUNK02", "PVC Trunking 16 x 16 x 3mtr", 16.25, { sold_in_length: true, unit_length: 3, price_per_metre: 5.42 }),
  c("DPIPE01", "PVC Pipe 20mm x 4mtr", 28, { sold_in_length: true, unit_length: 4, price_per_metre: 7 }),
  c("TRUNKCAP01", "End Caps 100 x 40", 14.76), c("ELB001", "PVC Elbow 20mm", 3.75),
];

const comp = (code: string, cost: number, ppm: number, len: number) => ({
  quantity: 1, length_metres: 1, is_length_item: true, is_optional: false,
  product: { id: code, product_code: code, short_name: code, product_category: "Consumables", category: "Consumables",
    cost_price: cost, cost_excl_vat: cost, price_per_metre: ppm, sold_in_length: true, unit_length: len, default_markup_percent: 100, supplier_name: "One Stop" },
});
const kit12 = { id: "kit12", name: "12K PIPING KIT", min_btu: 11000, max_btu: 13000, items: [comp("COPRL001", 900, 60, 15.24), comp("COPRL002", 1265.44, 83.03, 15.24)] };

const items = (brac: string, kit: string) => [
  { id: "k", role: "piping_kit", bundle_id: kit, product_code: null, default_qty: 1, default_length_m: 3, included: true, sort_order: 1 },
  { id: "b", role: "bracket", bundle_id: null, product_code: brac, default_qty: 1, default_length_m: null, included: true, sort_order: 2 },
  { id: "t", role: "trunking_main", bundle_id: null, product_code: "TRUNK01", default_qty: 1, default_length_m: null, included: true, sort_order: 3 },
  { id: "e", role: "trunking_endcap", bundle_id: null, product_code: "TRUNKCAP01", default_qty: 1, default_length_m: null, included: true, sort_order: 4 },
  { id: "s", role: "trunking_small", bundle_id: null, product_code: "TRUNK02", default_qty: 1, default_length_m: null, included: true, sort_order: 5 },
  { id: "d", role: "drain_pipe", bundle_id: null, product_code: "DPIPE01", default_qty: 1, default_length_m: null, included: true, sort_order: 6 },
  { id: "l", role: "drain_bend", bundle_id: null, product_code: "ELB001", default_qty: 3, default_length_m: null, included: true, sort_order: 7 },
] as any;
export const TEMPLATES: InstallTemplate[] = [
  { id: "t9", name: "9K", min_btu: 8000, max_btu: 10000, is_active: true, sort_order: 1, items: items("BRAC01", "kit9") },
  { id: "t12", name: "12K", min_btu: 11000, max_btu: 13000, is_active: true, sort_order: 2, items: items("BRAC01", "kit12") },
  { id: "t18", name: "18K", min_btu: 17000, max_btu: 19000, is_active: true, sort_order: 3, items: items("BRAC02", "kit18") },
  { id: "t24", name: "24K", min_btu: 22000, max_btu: 26000, is_active: true, sort_order: 4, items: items("BRAC05", "kit24") },
];

const unit = (code: string, btu: number, cost: number) => ({
  id: code, product_code: code, short_name: `Samsung ${btu / 1000}K INV MW`, product_category: "Air Conditioning", category: "Air Conditioning",
  cost_price: cost, cost_excl_vat: cost, default_markup_percent: 25, supplier_name: "Samsung", btu_rating: btu,
}) as any;

describe("standard install", () => {
  it("picks template by BTU; no match → null", () => {
    expect(pickInstallTemplate(TEMPLATES, 9000)?.id).toBe("t9");
    expect(pickInstallTemplate(TEMPLATES, 12000)?.id).toBe("t12");
    expect(pickInstallTemplate(TEMPLATES, 18000)?.id).toBe("t18");
    expect(pickInstallTemplate(TEMPLATES, 24000)?.id).toBe("t24");
    expect(pickInstallTemplate(TEMPLATES, 30000)).toBeNull();
  });

  it("prices install lines at book value per supplier length", () => {
    setActiveQuoteMarkupRates({ units: 25, materials: 100 } as any);
    const price = (code: string) => catalogLineFields(LIVE.find((p) => p.product_code === code), 1).unit_price;
    expect(price("TRUNK01")).toBeCloseTo(264.5, 2);
    expect(price("TRUNK02")).toBeCloseTo(32.5, 2);
    expect(price("DPIPE01")).toBeCloseTo(56, 2);
    expect(price("TRUNKCAP01")).toBeCloseTo(29.52, 2);
    expect(price("ELB001")).toBeCloseTo(7.5, 2);
    expect(price("BRAC01")).toBe(420);
    expect(price("BRAC02")).toBe(450);
    expect(price("BRAC05")).toBe(550);
    expect(lengthLabel(1, 3)).toBe("1 × 3 m length");
    expect(lengthLabel(2, 4)).toBe("2 × 4 m lengths");
  });

  it("adds unit + 3 m kit + 6 tagged lines, no parent_item_id; skips non-live codes with a note", async () => {
    setActiveQuoteMarkupRates({ units: 25, materials: 100 } as any);
    const rows: any[] = [];
    const addItem = async (i: any) => { const r = { ...i, id: `row${rows.length}` }; rows.push(r); return r; };
    const live = LIVE.filter((p) => p.product_code !== "TRUNK02");
    const r = await addCatalogProductToQuote({ addItem, product: unit("AR40F12C0AG/FA", 12000, 7790.61), areaId: "a", sortOrder: 0, bundles: [kit12], templates: TEMPLATES, liveProducts: live });
    expect(r.kit?.length).toBe(3);
    expect(r.kit?.metadata.install).toEqual({ unit_item_id: "row0", role: "piping_kit", template_id: "t12" });
    expect(r.installLines.map((l) => l.item_number)).toEqual(["BRAC01", "TRUNK01", "TRUNKCAP01", "DPIPE01", "ELB001"]);
    expect(rows.every((x) => x.parent_item_id == null)).toBe(true);
    expect(rows.slice(1).every((x) => x.metadata.install.unit_item_id === "row0")).toBe(true);
    expect(r.notes).toEqual(["Skipped TRUNK02 – not in active price books"]);
    expect(rows.find((x) => x.item_number === "ELB001").quantity).toBe(3);
  });

  it("no template → kit-only at 3 m", async () => {
    const rows: any[] = [];
    const addItem = async (i: any) => { const r = { ...i, id: `row${rows.length}` }; rows.push(r); return r; };
    const r = await addCatalogProductToQuote({ addItem, product: unit("X", 12000, 7000), areaId: "a", sortOrder: 0, bundles: [kit12] });
    expect(rows.length).toBe(2);
    expect(r.kit?.length).toBe(3);
  });
});
