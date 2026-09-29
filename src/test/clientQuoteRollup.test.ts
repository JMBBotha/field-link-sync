import { describe, it, expect } from "vitest";
import { buildClientRollup, rollupLineFromRow, clientDiscount, type RollupLine } from "@/lib/clientQuoteRollup";

// Fixture: 3 billable areas (multi-unit, service-only, normal) + an empty area + a zero-labour area, 10% discount.
const areas = [
  { id: "a-lounge", name: "Lounge", sort_order: 0 },
  { id: "a-bed2", name: "Bedroom 2", sort_order: 1 },
  { id: "a-study", name: "Study", sort_order: 2 },
  { id: "a-empty", name: "Garage", sort_order: 3 },
  { id: "a-zero", name: "Patio", sort_order: 4 },
];
const unit = (id: string, area: string, name: string, code: string, qty: number, price: number, desc: string, extra: Partial<RollupLine> = {}): RollupLine => ({
  id, area_id: area, item_name: name, item_number: code, quantity: qty, unit_price: price, total_price: null,
  item_type: "product", category: "Midwall Inverter", brand: "Samsung", btu_rating: 12000, description: desc,
  ai_sales_description: "CATALOGUE AI BLURB", image_url: `https://img/${id}.png`, ...extra,
});
const line = (id: string, area: string | null, name: string, qty: number, price: number, extra: Partial<RollupLine> = {}): RollupLine => ({
  id, area_id: area, item_name: name, quantity: qty, unit_price: price, total_price: null, item_type: "product", ...extra,
});
const lines: RollupLine[] = [
  unit("u1", "a-lounge", "Samsung 12K INV MW", "AR40F12C0AG/FA", 2, 9738.26, "Edited: quiet unit for the lounge"),
  unit("u2", "a-lounge", "Samsung 24K INV MW", "AR40F24C0AG/FA", 1, 17825.22, "Edited: big unit", { btu_rating: 24000 }),
  line("k1", "a-lounge", "24K INV 1/4&1/2 PIPING KIT COPPER LASSO", 1, 2422.4, { item_type: "Installation Kit", is_bundle: true }),
  line("b1", "a-lounge", "Galvanized Brackets 650mm (Per Set)", 2, 550, { category: "Consumables" }),
  line("t1", "a-lounge", "PVC Trunking 100 x 40 x 3mtr", 2.5, 88.168, { total_price: 220.42, category: "Consumables" }),
  line("l1", "a-lounge", "Labour", 10.5, 680, { item_type: "labour" }),
  line("s1", "a-bed2", "Gas top-up (R32)", 2, 725, { item_type: "service", description: "Leak test and R32 top-up of the existing unit" }),
  line("l2", "a-bed2", "Labour", 1, 680, { item_type: "labour" }),
  unit("u3", "a-study", "Samsung 9K INV MW", "AR40F09C0AG/FA", 1, 8450, "Edited: study unit", { btu_rating: 9000 }),
  line("k3", "a-study", "09K/12K INV 1/4&3/8 PIPING KIT COPPER", 1, 928.48, { item_type: "Installation Kit", is_bundle: true }),
  line("l3", "a-study", "Labour", 3.5, 680, { item_type: "labour" }),
  line("l4", "a-zero", "Labour", 0, 680, { item_type: "labour" }),
];
const subtotal = lines.reduce((s, l) => s + (Number(l.total_price) || Number(l.quantity) * Number(l.unit_price)), 0);

describe("client roll-up (PDF + /quote)", () => {
  const out = buildClientRollup(lines, areas);

  it("one block per billable area, in area order; empty/zero areas skipped", () => {
    expect(out.map((a) => a.areaName)).toEqual(["Lounge", "Bedroom 2", "Study"]);
  });

  it("multi-unit area lists 'qty × name, model' with the edited description, one total", () => {
    const lounge = out[0];
    expect(lounge.units.map((u) => u.unitName)).toEqual([
      "2 × Samsung 12K INV MW, AR40F12C0AG/FA",
      "Samsung 24K INV MW, AR40F24C0AG/FA",
    ]);
    expect(lounge.units.map((u) => u.unitDescription)).toEqual(["Edited: quiet unit for the lounge", "Edited: big unit"]);
    expect(lounge.areaTotal).toBeCloseTo(2 * 9738.26 + 17825.22 + 2422.4 + 1100 + 220.42 + 10.5 * 680, 2);
    expect(lounge.hasInstallExtras).toBe(true);
  });

  it("service-only area prints the service name (no qty/model) and edited description", () => {
    const bed = out[1];
    expect(bed.units).toEqual([{ unitName: "Gas top-up (R32)", unitDescription: "Leak test and R32 top-up of the existing unit", imageUrl: null }]);
    expect(bed.areaTotal).toBeCloseTo(1450 + 680, 2);
    expect(bed.hasInstallExtras).toBe(false);
  });

  it("area totals add up to the subtotal and nothing client-facing is blank or a kit/material/labour line", () => {
    expect(out.reduce((s, a) => s + a.areaTotal, 0)).toBeCloseTo(subtotal, 2);
    for (const a of out) {
      expect(a.areaName.trim()).not.toBe("");
      expect(a.units.length).toBeGreaterThan(0);
      for (const u of a.units) {
        expect(u.unitName.trim()).not.toBe("");
        expect(u.unitDescription?.trim()).toBeTruthy();
        expect(u.unitName).not.toMatch(/kit|bracket|trunking|labour|copper/i);
      }
    }
  });

  it("falls back to the catalogue blurb only when the line has no description", () => {
    const [a] = buildClientRollup([unit("u9", "a-lounge", "Samsung 12K INV MW", "AR40F12C0AG/FA", 1, 1, "")], areas);
    expect(a.units[0].unitDescription).toBe("CATALOGUE AI BLURB");
    expect(a.units[0].unitName).toBe("Samsung 12K INV MW, AR40F12C0AG/FA");
  });

  it("uses product_code when the line has no item_number and never repeats a code already in the name", () => {
    const [a] = buildClientRollup([
      unit("u8", "a-lounge", "Midea 18K", "", 1, 1, "x", { product_code: "MSAG-18" }),
      unit("u7", "a-lounge", "LG 12K S3-Q12", "S3-Q12", 3, 1, "y"),
    ], areas);
    expect(a.units.map((u) => u.unitName)).toEqual(["Midea 18K, MSAG-18", "3 × LG 12K S3-Q12"]);
  });

  it("whole-job labour becomes a last 'Job labour' block", () => {
    const job = line("j1", null, "Job labour", 14, 680, { item_type: "labour", metadata: { labour: true, labour_scope: "job" } });
    const res = buildClientRollup([...lines.filter((l) => l.item_type !== "labour"), job], areas);
    expect(res.map((a) => a.areaName)).toEqual(["Lounge", "Bedroom 2", "Study", "Job labour"]);
    expect(res.at(-1)).toMatchObject({ isJobLabour: true, units: [], areaTotal: 14 * 680 });
  });

  it("staff PDF rows (DB select, nested supplier_products) roll up identically to the /quote RPC payload", () => {
    const names = new Map(areas.map((a) => [a.id, a.name]));
    const job = line("j1", null, "Job labour", 14, 680, { item_type: "labour" });
    const all = [...lines, job];
    // Exactly the item keys get_public_quote returns (no metadata / cost).
    const RPC_KEYS = ["id", "item_name", "description", "quantity", "unit_price", "total_price", "sort_order", "product_id", "area_id",
      "item_type", "image_url", "category", "brand", "btu_rating", "capacity_btu", "kw", "ai_sales_description", "item_number", "is_bundle", "product_code"] as const;
    const rpcItems = all.map((l) => ({
      ...Object.fromEntries(RPC_KEYS.map((k) => [k, (l as any)[k] ?? null])),
      area_name: l.area_id ? names.get(l.area_id) ?? null : null,
    }));
    // What ClientQuotePdfRoot selects: flat quote_items columns + nested supplier_products, plus staff-only metadata.
    const dbRows = all.map((l) => ({
      id: l.id, item_name: l.item_name, description: l.description ?? null, quantity: l.quantity, unit_price: l.unit_price,
      total_price: l.total_price, sort_order: l.sort_order ?? null, product_id: l.product_id ?? null, area_id: l.area_id, item_type: l.item_type,
      item_number: l.item_number ?? null, is_bundle: l.is_bundle ?? null, parent_item_id: null,
      metadata: l.item_type === "labour" ? { labour: true, labour_scope: l.area_id ? "area" : "job" } : { cost: 1 },
      supplier_products: { image_url: l.image_url ?? null, category: l.category ?? null, brand: l.brand ?? null, btu_rating: l.btu_rating ?? null,
        capacity_btu: l.capacity_btu ?? null, kw: l.kw ?? null, ai_sales_description: l.ai_sales_description ?? null, product_code: l.product_code ?? null },
    }));
    const staff = buildClientRollup(dbRows.map((r) => rollupLineFromRow(r, names)), areas);
    const pub = buildClientRollup(rpcItems as any, areas);
    expect(staff).toEqual(pub);
    expect(pub.map((a) => a.areaName)).toEqual(["Lounge", "Bedroom 2", "Study", "Job labour"]);
  });

  it("discount matches the /quote page rule", () => {
    expect(clientDiscount(subtotal, "percentage", 10)).toEqual({ amount: subtotal * 0.1, label: "10%" });
    expect(clientDiscount(1000, "percent", 5)).toEqual({ amount: 50, label: "5%" });
    expect(clientDiscount(1000, "fixed", 250)).toEqual({ amount: 250, label: null });
    expect(clientDiscount(1000, "percentage", 0)).toEqual({ amount: 0, label: null });
  });
});
