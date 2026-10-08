import { describe, it, expect } from "vitest";
import { catalogLineFields, isPerMetreTrunking, planStandardInstall, installBasketItem, perMetreTotal } from "@/lib/mandy/quoteOps";
import { runInstallEdit, parseInstallCommand, readInstall, metresFromRequest } from "@/lib/mandy/installEdits";
import { qtyUnitLabel } from "@/lib/installTemplates";
import { lineQtyText, buildClientRollup } from "@/lib/clientQuoteRollup";
import { stubProductFromQuoteItem } from "@/utils/hydrateQuoteItem";
import { calculateBasketItemSell } from "@/utils/quoteBasketTotals";

const prod = (code: string, name: string, cost: number, extra: any = {}) => ({
  id: code, product_code: code, short_name: name, product_category: "Consumables", category: "Consumables",
  cost_price: cost, cost_excl_vat: cost, default_markup_percent: 100, supplier_name: "X", ...extra,
}) as any;
const len = (L: number) => ({ sold_in_length: true, unit_length: L, price_per_metre: 1 });
const T1 = prod("TRUNK01", "PVC Trunking - PVC Trunking 100 x 40 x 3mtr", 132.25, len(3));
const T2 = prod("TRUNK02", "PVC Trunking - PVC Trunking 16 x 16 x 3mtr", 16.25, len(3));
const T3 = prod("TRUNK03", "PVC Trunking - PVC Trunking 40 x 40 x 3mtr", 46.73, len(3));
const CAP = prod("TRUNKCAP01", "PVC End Caps - PVC End Caps 100 x 40", 14.76);
const DRAIN = prod("DPIPE01", "PVC Pipe - PVC Pipe 20mm x 4mtr", 28, len(4));

describe("per-metre trunking pricing", () => {
  it("detects trunking generically; end caps and drain are not", () => {
    expect([T1, T2, T3].every(isPerMetreTrunking)).toBe(true);
    expect(isPerMetreTrunking(CAP)).toBe(false);
    expect(isPerMetreTrunking(DRAIN)).toBe(false);
  });
  it.each([[T1, 96.98, 290.94], [T2, 11.92, 35.76], [T3, 34.27, 102.81]])("%s unit price per metre + 3 m total", (p, rate, total) => {
    const f = catalogLineFields(p, 3);
    expect(f.unit_price).toBe(rate);
    expect((f as any).total_price).toBe(total);
    expect(f.metadata).toMatchObject({ qty_unit: "metre", supplier_length_m: 3 });
  });
  it("1.5 m and 4 m of TRUNK01", () => {
    expect((catalogLineFields(T1, 1.5) as any).total_price).toBe(145.47);
    expect((catalogLineFields(T1, 4) as any).total_price).toBe(387.92);
    expect(perMetreTotal(3, 264.5, 3)).toBe(264.5);
  });
  it("end cap and drain unchanged", () => {
    const c = catalogLineFields(CAP, 2);
    expect(c.unit_price).toBe(29.52);
    expect((c as any).total_price).toBeUndefined();
    const d = catalogLineFields(DRAIN, 1);
    expect(d.unit_price).toBe(15.4); // drain pipe is now a metre line with 10% waste
    expect(d.metadata).toMatchObject({ qty_unit: "metre", supplier_length_m: 4, waste_percent: 10 });
  });
  it("display label", () => {
    expect(qtyUnitLabel(3, { qty_unit: "metre", supplier_length_m: 3 }, 88.1667)).toBe("3 m · R88.17/m");
    expect(qtyUnitLabel(1, { qty_unit: "length", supplier_length_m: 3 }, 264.5)).toBe("1 × 3 m length");
  });
});

describe("standard install adds 3 m trunking (per metre + waste)", () => {
  const tpl = [{ id: "t", name: "12K", min_btu: 9000, max_btu: 12000, is_active: true, sort_order: 0, items: [
    { id: "i1", role: "trunking_main", bundle_id: null, product_code: "TRUNK01", default_qty: 1, default_length_m: null, included: true, sort_order: 1 },
    { id: "i2", role: "trunking_small", bundle_id: null, product_code: "TRUNK02", default_qty: 1, default_length_m: 2, included: true, sort_order: 2 },
    { id: "i3", role: "trunking_endcap", bundle_id: null, product_code: "TRUNKCAP01", default_qty: 1, default_length_m: null, included: true, sort_order: 3 },
  ] }] as any;
  const unit = { id: "u", short_name: "Samsung 12K", product_category: "Air Conditioning", btu_rating: 12000 } as any;
  it("default_qty lengths × 3 m; default_length_m used as metres; install total unchanged for 1 length", () => {
    const plan = planStandardInstall(unit, tpl, [], [T1, T2, CAP]);
    expect(plan.lines.map((l) => l.qty)).toEqual([3, 2, 1]);
    const f = catalogLineFields(plan.lines[0].product, plan.lines[0].qty) as any;
    expect(f.total_price).toBe(290.94);
  });
  it("builder basket line totals exactly the book price and survives reopen", () => {
    const plan = planStandardInstall(unit, tpl, [], [T1, T2, CAP]);
    const b = installBasketItem(plan.lines[0], "u", "t") as any;
    expect(b.install.qty_unit).toBe("metre");
    expect(calculateBasketItemSell(b)).toBe(290.94);
    expect(calculateBasketItemSell({ ...b, quantity: 1.5 })).toBe(145.47);
    const re = stubProductFromQuoteItem({ id: "x", unit_price: 88.1667, quantity: 3, metadata: { qty_unit: "metre", supplier_length_m: 3, unit_cost: 44.0833 } });
    expect(calculateBasketItemSell({ instanceId: "x", product: re, quantity: 3 } as any)).toBe(264.5);
    expect(calculateBasketItemSell({ instanceId: "x", product: re, quantity: 4 } as any)).toBe(352.67);
  });
  it("old per-length line still totals qty × unit_price on reopen", () => {
    const re = stubProductFromQuoteItem({ id: "o", unit_price: 264.5, quantity: 2, metadata: { qty_unit: "length", supplier_length_m: 3 } });
    expect(calculateBasketItemSell({ instanceId: "o", product: re, quantity: 2 } as any)).toBe(529);
  });
});

const tag = (role: string) => ({ install: { unit_item_id: "u1", role, template_id: "t" } });
const items = (trunk: any): any[] => [
  { id: "u1", item_name: "Samsung 24K", area_id: "a1", quantity: 1, unit_price: 15000, metadata: {} },
  trunk,
];
const metreLine = { id: "tr", item_name: "PVC Trunking 100 x 40 x 3mtr", item_number: "TRUNK01", area_id: "a1", quantity: 3, unit_price: 88.1667, total_price: 264.5, metadata: { ...tag("trunking_main"), qty_unit: "metre", supplier_length_m: 3 } };
const oldLine = { id: "tr", item_name: "PVC Trunking 100 x 40 x 3mtr", item_number: "TRUNK01", area_id: "a1", quantity: 1, unit_price: 264.5, metadata: { ...tag("trunking_main"), qty_unit: "length", supplier_length_m: 3 } };
function deps(list: any[]) {
  const log: any[] = [];
  return { log, d: { items: list, areaName: () => "Lounge", liveProducts: [T1, T2, CAP], addItem: async (r: any) => { log.push(["add", r]); return { ...r, id: "n" }; }, updateItem: async (id: string, p: any) => { log.push(["upd", id, p]); return true; }, deleteItem: async () => true } };
}

describe("Mandy per-metre trunking", () => {
  it("parses metres and lengths", () => {
    expect(parseInstallCommand("make the trunking 1.5 metres")).toEqual({ op: "set_qty", role: "trunking_main", metres: 1.5 });
    expect(parseInstallCommand("two lengths of 100 by 40")).toEqual({ op: "set_qty", role: "trunking_main", lengths: 2 });
    expect(metresFromRequest({ lengths: 2 }, "", 3)).toBe(6);
    expect(metresFromRequest({ qty: 4 }, "set trunking to 4", 3)).toBe(4);
    expect(metresFromRequest({ qty: 2 }, "two lengths of trunking", 3)).toBe(6);
  });
  it("1.5 m read-back", async () => {
    const { d, log } = deps(items(metreLine));
    const r = await runInstallEdit(d as any, { op: "set_qty", role: "trunking_main", metres: 1.5 });
    expect(log[0][2]).toEqual({ quantity: 1.5, total_price: 132.25 });
    expect(r.message).toMatch(/^Trunking is now 1\.5 m, R132[.,]25\.$/);
  });
  it("two lengths → 6 m", async () => {
    const { d, log } = deps(items(metreLine));
    await runInstallEdit(d as any, { op: "set_qty", role: "trunking_main", lengths: 2 });
    expect(log[0][2]).toEqual({ quantity: 6, total_price: 529 });
  });
  it("no-op", async () => {
    const { d, log } = deps(items(metreLine));
    const r = await runInstallEdit(d as any, { op: "set_qty", role: "trunking_main", qty: 3 });
    expect(log.length).toBe(0);
    expect(r.message).toBe("Trunking is already 3 m, so nothing changed.");
  });
  it("old per-length line keeps lengths", async () => {
    const { d, log } = deps(items(oldLine));
    await runInstallEdit(d as any, { op: "set_qty", role: "trunking_main", lengths: 2 });
    expect(log[0][2]).toEqual({ quantity: 2, total_price: 529 });
  });
  it("read_install says 3 m of 100x40 trunking", () => {
    expect(readInstall(items(metreLine), () => "Lounge").message).toBe("Lounge Samsung 24K: 3 m of 100x40 trunking.");
  });
  it("missing trunking is added in metres", async () => {
    const { d, log } = deps([items(metreLine)[0], { id: "b", item_name: "Bracket", area_id: "a1", quantity: 1, unit_price: 420, metadata: tag("bracket") }]);
    await runInstallEdit(d as any, { op: "set_qty", role: "trunking_main", metres: 3 });
    expect(log[0][1]).toMatchObject({ quantity: 3, unit_price: 96.98, total_price: 290.94 });
  });
});

describe("client document", () => {
  it("line text 3 m and roll-up still sums totals", () => {
    expect(lineQtyText(metreLine)).toBe("3 m");
    expect(lineQtyText({ quantity: 1.5, metadata: { qty_unit: "metre" } })).toBe("1.5 m");
    expect(lineQtyText(oldLine)).toBeNull();
    const r = buildClientRollup([
      { id: "u", item_name: "Samsung", area_id: "a", quantity: 1, unit_price: 15000, category: "Air Conditioning" },
      { id: "t", item_name: "Trunking", area_id: "a", quantity: 1.5, unit_price: 88.1667, total_price: 132.25 },
    ], [{ id: "a", name: "Lounge" }]);
    expect(r[0].areaTotal).toBe(15132.25);
  });
});
