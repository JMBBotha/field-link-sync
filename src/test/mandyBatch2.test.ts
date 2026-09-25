import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  matchQuoteItem, findUnitKits, snapQty, qtyPatch, linePriceDecision, priceFloor, duplicateAreaRows,
  parsePlan, runPlanSteps, planReportText,
} from "@/lib/mandy/quoteEdits";
import { previewPlan } from "@/lib/mandy/planPreview";
import { gateDecision, gatePlan } from "@/lib/mandy/gate";
import { CONFIRM_REQUIRED } from "@/lib/mandy/actions";
import { postProcessRoute } from "@/lib/mandy/router";
import { QUOTES_LIST_DEFAULT_SORT, quotesListCompare } from "@/lib/mandy/latestQuote";
import { topOfListResult } from "@/lib/mandy/topOfList";
import { areaChipsForAdd, NEW_AREA_LABEL } from "@/components/mandy/MandyQuoteActions";
import { setActiveQuoteMarkupRates } from "@/lib/pricing";

const rates = { units: 25, materials: 100 };
const areas = [{ id: "G", name: "General" }, { id: "B1", name: "Bedroom 1" }];
const unit = { id: "U", area_id: "B1", item_name: "Samsung 12K INV MW", item_number: "AR40F12C0AG/FA", item_type: "product", product_id: "P12", quantity: 1, unit_price: 9738.26, total_price: 9738.26, sort_order: 1, metadata: { unit_cost: 7790.61, markup_percent: 25, price_locked: true } };
const kit = { id: "K", area_id: "B1", item_name: "12K INV 1/4&1/2 PIPING KIT COPPER LASSO ISO CABLE TIES ONLY", item_type: "Installation Kit", is_bundle: true, quantity: 1, length: 1, unit_price: 364.1, total_price: 364.1, sort_order: 2, metadata: { unit_cost: 182.05, markup_percent: 100, kit: { unit_cost: 182.05, pricing_type: "p/meter" } } };
const labour = { id: "L", area_id: "G", item_name: "Labour", item_type: "labour", quantity: 3, unit_price: 680, total_price: 2040, sort_order: 0, metadata: { labour: true, hours: 3, rate: 680, unit_cost: 680, markup_percent: 0 } };
const items: any[] = [labour, unit, kit];

afterEach(() => setActiveQuoteMarkupRates(null));

describe("item matching", () => {
  it("resolves 'the labour', 'the Samsung', 'the kit in bedroom 1'", () => {
    expect(matchQuoteItem(items, areas, "the labour").hits.map((h) => h.id)).toEqual(["L"]);
    expect(matchQuoteItem(items, areas, "the Samsung").hits.map((h) => h.id)).toEqual(["U"]);
    const m = matchQuoteItem(items, areas, "the kit in bedroom 1");
    expect(m.area?.id).toBe("B1");
    expect(m.hits.map((h) => h.id)).toEqual(["K"]);
  });
  it("ambiguous → several hits (caller shows chips)", () => {
    const two = [...items, { ...unit, id: "U2", area_id: "G" }];
    expect(matchQuoteItem(two, areas, "the Samsung").hits.length).toBe(2);
  });
});

describe("set_qty", () => {
  it("respects qty_step and min_qty", () => {
    expect(snapQty(3, { qty_step: 2, min_qty: 2 })).toBe(4);
    expect(snapQty(0, { qty_step: 1, min_qty: 1 })).toBe(1);
    expect(snapQty(2.5, { qty_step: 0.5, min_qty: 0.5, allows_decimal_qty: true })).toBe(2.5);
  });
  it("kits change length the builder way", () => {
    const p = qtyPatch(kit as any, 3);
    expect(p.kind).toBe("length");
    expect(p.patch.length).toBe(3);
    expect(p.patch.unit_price).toBeCloseTo(1092.3, 2);
    expect(p.patch.metadata.unit_cost).toBeCloseTo(546.15, 2);
  });
  it("normal lines change quantity and totals", () => {
    const p = qtyPatch(unit as any, 2, { qty_step: 1, min_qty: 1 });
    expect(p.patch).toMatchObject({ quantity: 2, total_price: 19476.52 });
  });
  it("labour changes hours at the saved rate", () => {
    const p = qtyPatch(labour as any, 4);
    expect(p.kind).toBe("hours");
    expect(p.patch).toMatchObject({ quantity: 4, unit_price: 680, total_price: 2720 });
  });
});

describe("set_line_price", () => {
  it("floor = cost × (1 + category markup)", () => {
    expect(priceFloor(unit as any, rates)).toBeCloseTo(9738.26, 2);
    expect(priceFloor(kit as any, rates)).toBeCloseTo(364.1, 2);
  });
  it("refuses below the floor and reports it", () => {
    const d = linePriceDecision(unit as any, 9000, rates);
    expect(d.kind).toBe("refuse");
    expect((d as any).floor).toBeCloseTo(9738.26, 2);
  });
  it("above list applies an override without touching cost", () => {
    const d = linePriceDecision(unit as any, 10500, rates);
    expect(d.kind).toBe("apply");
    const m = (d as any).patch.metadata;
    expect(m).toMatchObject({ price_overridden: true, override_price: 10500, original_sell: 9738.26, unit_cost: 7790.61, manual_price: true });
  });
  it("below list (but above floor) needs Confirm", () => {
    const pricey = { ...unit, unit_price: 11000, metadata: { ...unit.metadata, original_sell: 11000 } };
    expect(linePriceDecision(pricey as any, 10000, rates).kind).toBe("confirm");
  });
});

describe("move / duplicate / remove", () => {
  it("a unit's kit moves with it", () => {
    expect(findUnitKits(items, unit as any).map((k) => k.id)).toEqual(["K"]);
    expect(findUnitKits(items, labour as any)).toEqual([]);
  });
  it("duplicate copies stored prices and metadata, no repricing", () => {
    const rows = duplicateAreaRows(items, "B1");
    expect(rows.map((r) => r.row.unit_price)).toEqual([9738.26, 364.1]);
    expect(rows[0].row.metadata).toEqual(unit.metadata);
    expect(rows[0].row.metadata).not.toBe(unit.metadata);
    expect(rows[0].row).not.toHaveProperty("id");
  });
  it("remove always needs Confirm", () => {
    expect(CONFIRM_REQUIRED.has("remove_item")).toBe(true);
    expect(gateDecision("remove_item", 1, { quoteStatus: "draft" }).kind).toBe("confirm");
  });
});

describe("open latest / top of list", () => {
  it("latest follows the Quotes list default sort", () => {
    expect(QUOTES_LIST_DEFAULT_SORT).toMatchObject({ column: "created_at", ascending: false, excludeStatus: "superseded" });
    const rows = [{ created_at: "2026-09-01" }, { created_at: "2026-09-20" }, { created_at: "2026-09-10" }].sort(quotesListCompare);
    expect(rows[0].created_at).toBe("2026-09-20");
    const src = fs.readFileSync(path.resolve("src/components/quoting/QuotesList.tsx"), "utf8");
    expect(src).toContain(".sort(quotesListCompare)");
  });
  it("'open the top one' opens row 0 of the list as rendered", () => {
    const open = vi.fn();
    const r = topOfListResult([{ id: "a", ref: "Q-1", kind: "estimate" }, { id: "b", ref: "Q-2", kind: "estimate" }], open);
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
    expect(r.data?.route).toBe("/admin/estimates/a");
  });
});

describe("server-side add path retired", () => {
  it("no edge function inserts quote_items", () => {
    const dir = path.resolve("supabase/functions");
    const files: string[] = [];
    const walk = (d: string) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".ts") && files.push(path.join(d, e.name))));
    walk(dir);
    const offenders = files.filter((f) => /from\(\s*["']quote_items["']\s*\)\s*\.insert/.test(fs.readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
    expect(fs.readFileSync(path.join(dir, "_shared/nlTools.ts"), "utf8")).not.toMatch(/name:\s*"add_quote_item"/);
  });
});

describe("AC add without an area", () => {
  it("asks with existing areas plus New area…", () => {
    const c = areaChipsForAdd(areas, { product_id: "P12", quantity: 1 });
    expect(c.map((x) => x.label)).toEqual(["General", "Bedroom 1", NEW_AREA_LABEL]);
    expect(c[2].args).toMatchObject({ product_id: "P12", area: "Area 3" });
  });
});

/* ───────── C: plans ───────── */
const comp = (code: string, cost: number, ppm: number, len: number) => ({
  quantity: 1, length_metres: 1, is_length_item: true, is_optional: false,
  product: { id: code, product_code: code, short_name: code, product_category: "Consumables", category: "Consumables", cost_price: cost, cost_excl_vat: cost, price_per_metre: ppm, sold_in_length: true, unit_length: len, default_markup_percent: 100 },
});
const bundles = [{ id: "k12", name: "12K INV 1/4&1/2 PIPING KIT", items: [comp("COPRL001", 600, 39.37, 15.24), comp("COPRL003", 1100, 72.18, 15.24)] }];
const products = [{ id: "P12", product_code: "AR40F12C0AG/FA", short_name: "Samsung 12K INV MW", brand: "Samsung", product_category: "Air Conditioning", category: "Air Conditioning", cost_price: 7790.608, cost_excl_vat: 7790.608, default_markup_percent: 25, markup_percent: 25, supplier_type: "ac_units", description: "" }];

describe("plans", () => {
  it("router turns run_plan into ordered steps, labour mode from the verb", () => {
    const r = postProcessRoute({ action: "run_plan", args: { steps: [
      { action: "add_item_to_area", args: { area: "Bedroom 2", query: "12K Samsung" } },
      { action: "set_kit_length", args: { area: "Bedroom 2", metres: 3 } },
      { action: "set_labour_hours", args: { area: "Bedroom 2", hours: 2 } },
    ] }, confidence: 0.9 }, "Bedroom 2: add a 12K Samsung with 3 m kit and 2 hours labour");
    expect(r.plan?.map((s) => s.action)).toEqual(["add_item_to_area", "set_kit_length", "set_labour_hours"]);
    expect(r.plan?.[2].args.mode).toBe("add");
    expect(parsePlan({ steps: [{ action: "" }, { action: "run_plan" }, { action: "add_area", args: '{"name":"X"}' }] })).toEqual([{ action: "add_area", args: { name: "X" } }]);
  });

  it("preview uses shared pricing and does not change the quote", async () => {
    setActiveQuoteMarkupRates(rates);
    const before = JSON.stringify(items);
    const p = await previewPlan([
      { action: "add_item_to_area", args: { area: "Bedroom 2", query: "Samsung 12K" } },
      { action: "set_kit_length", args: { area: "Bedroom 2", metres: 3 } },
      { action: "set_labour_hours", args: { area: "Bedroom 2", hours: 2, mode: "add" } },
    ], { items, areas, products, bundles, rates, standardRate: 680, vatRate: 0.15 });
    expect(p.error).toBeUndefined();
    expect(JSON.stringify(items)).toBe(before);
    const unitLine = p.lines.find((l) => l.action === "add_item_to_area")!;
    expect(unitLine.price).toBeCloseTo(9738.26, 2);
    const kitLine = p.lines.find((l) => l.action === "set_kit_length")!;
    expect(kitLine.qty).toBe(3);
    const lab = p.lines.find((l) => l.action === "set_labour_hours")!;
    expect(lab.price).toBe(1360);
    expect(p.beforeExcl).toBeCloseTo(12142.36, 2);
    expect(p.afterExcl).toBeCloseTo(12142.36 + 9738.26 + kitLine.price! + 1360, 2);
    expect(p.after).toBeCloseTo(p.afterExcl * 1.15, 1);
  });

  it("stops at the first error and reports which steps ran", async () => {
    const exec = vi.fn()
      .mockResolvedValueOnce({ ok: true, message: "a" })
      .mockResolvedValueOnce({ ok: false, message: "boom" })
      .mockResolvedValueOnce({ ok: true, message: "c" });
    const rep = await runPlanSteps([{ action: "x", args: {} }, { action: "y", args: {} }, { action: "z", args: {} }], exec);
    expect(exec).toHaveBeenCalledTimes(2);
    expect(rep).toMatchObject({ ran: 1, failedAt: 1, total: 3 });
    expect(planReportText(rep)).toMatch(/Stopped at step 2 of 3; 1 step ran/);
  });

  it("cancel does nothing: preparing the card never executes a step", async () => {
    const exec = vi.fn();
    await previewPlan([{ action: "remove_item", args: { item: "the Samsung" } }], { items, areas, products, bundles, rates, standardRate: 680, vatRate: 0.15 });
    expect(exec).not.toHaveBeenCalled();
  });

  it("gate per plan: lowest confidence + highest risk decide; always one Confirm", () => {
    expect(gatePlan([{ action: "rename_area" }, { action: "remove_item" }], 0.9, { quoteStatus: "draft" }).kind).toBe("confirm");
    expect(gatePlan([{ action: "rename_area" }, { action: "add_item_to_area" }], 0.6, { quoteStatus: "draft" }).kind).toBe("chips");
    expect(gatePlan([{ action: "rename_area" }], 0.6, { quoteStatus: "draft" }).kind).toBe("confirm");
    expect(gatePlan([{ action: "add_item_to_area" }], 0.9, { quoteStatus: "sent" }).kind).toBe("block");
  });
});
