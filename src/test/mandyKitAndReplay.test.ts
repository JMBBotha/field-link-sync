import { describe, it, expect, afterEach } from "vitest";
import { kitLengthPatch, kitSellPerMetre, addCatalogProductToQuote } from "@/lib/mandy/quoteOps";
import { qtyPatch, duplicateAreaRows, linePriceDecision, matchQuoteItem, type EditItem } from "@/lib/mandy/quoteEdits";
import { guardRoute, postProcessRoute, type RouteResult } from "@/lib/mandy/router";
import { gateDecision, gatePlan } from "@/lib/mandy/gate";
import { MANDY_ACTION_SCHEMAS, CONFIRM_REQUIRED } from "@/lib/mandy/actions";
import { staleWriteRefusal } from "@/lib/buildInfo";
import { acNeedsAreaPick, areaChipsForAdd } from "@/components/mandy/MandyQuoteActions";
import { setActiveQuoteMarkupRates } from "@/lib/pricing";

afterEach(() => setActiveQuoteMarkupRates(null));

const kitMeta = { unit_cost: 182.05, cost_excl: 182.05, markup_percent: 100, kit: { unit_cost: 182.05124059492562, pricing_type: "p/meter", items: [1, 2, 3, 4, 5] } };
const goodKit = { id: "K", area_id: "B1", item_name: "12K kit", is_bundle: true, item_type: "Installation Kit", quantity: 1, length: 1, unit_price: 364.1, total_price: 364.1, metadata: kitMeta };

describe("12K kit per-metre price, whatever created the row", () => {
  it("1 m = R364.10 and 3 m = R1 092.30 from a clean row", () => {
    expect(kitLengthPatch(goodKit, 1).unit_price).toBeCloseTo(364.1, 2);
    expect(kitLengthPatch(goodKit, 3).unit_price).toBeCloseTo(1092.3, 2);
  });
  it("row whose length drifted without repricing (length 5 @ 1 m price) — the live bug", () => {
    const drifted = { ...goodKit, length: 5 };
    expect(kitSellPerMetre(drifted)).toBeCloseTo(364.1, 1);
    expect(kitLengthPatch(drifted, 3).unit_price).toBeCloseTo(1092.3, 1);
    expect(kitLengthPatch(drifted, 1).unit_price).toBeCloseTo(364.1, 1);
  });
  it("set_qty on a kit goes through the same patch", () => {
    expect(qtyPatch({ ...goodKit, length: 5 } as any, 3).patch.unit_price).toBeCloseTo(1092.3, 1);
  });
  it("duplicated kit keeps its price and still lengthens correctly", () => {
    const rows = duplicateAreaRows([goodKit as EditItem], "B1");
    const copy = rows[0].row as any;
    expect(copy.unit_price).toBe(364.1);
    expect(kitLengthPatch(copy, 3).unit_price).toBeCloseTo(1092.3, 1);
  });
  it("Mandy/catalog add stores unit_sell so later lengths never drift", async () => {
    setActiveQuoteMarkupRates({ units: 25, materials: 100 } as any);
    const comp = (code: string, cost: number, ppm: number, len: number) => ({
      quantity: 1, length_metres: 1, is_length_item: true, is_optional: false,
      product: { id: code, product_code: code, short_name: code, product_category: "Consumables", category: "Consumables", cost_price: cost, cost_excl_vat: cost, price_per_metre: ppm, sold_in_length: true, unit_length: len, supplier_name: "One Stop" },
    });
    const bundle = { id: "b12", name: "12K INV PIPING KIT", items: [comp("COPRL001", 900, 60, 15.24), comp("COPRL003", 1100, 70, 15.24), comp("IT009", 10, 5, 1.8), comp("IT011", 12, 6, 1.8), comp("TAPE006", 64.28, 2.14, 30)] };
    const unit = { id: "U12", product_code: "AR40F12C0AG/FA", short_name: "Samsung 12K INV MW", brand: "Samsung", product_category: "Air Conditioning", category: "Air Conditioning", cost_price: 7790.61, cost_excl_vat: 7790.61, supplier_name: "Samsung", description: "" } as any;
    const rows: any[] = [];
    await addCatalogProductToQuote({ addItem: (async (i: any) => { const r = { ...i, id: `r${rows.length}` }; rows.push(r); return r; }) as any, product: unit, areaId: "B1", sortOrder: 0, bundles: [bundle as any] });
    expect(rows[0].unit_price).toBeCloseTo(9738.26, 2);
    const k = rows[1];
    const perM = k.metadata.kit.unit_sell;
    expect(perM).toBeCloseTo(k.metadata.kit.unit_cost * 2, 2);
    expect(kitLengthPatch({ ...k, length: 5 }, 3).unit_price).toBeCloseTo(perM * 3, 1);
  });
});

const R = (action: string | null, args: Record<string, unknown> = {}, confidence = 0.9): RouteResult => ({ action, args, confidence });
const route = (r: RouteResult, t: string) => postProcessRoute(guardRoute(r, t), t);
const known = (a: string | null) => !!a && (a in MANDY_ACTION_SCHEMAS || a === "run_plan");
const draft = { quoteStatus: "draft" } as any;

describe("replay of the typed sentences on a CURRENT client", () => {
  it("client is current: writes are not refused", () => {
    expect(staleWriteRefusal("set_labour_hours", false)).toBeNull();
  });
  it("Add 1 hour labour to General", () => {
    const r = route(R("set_labour_hours", { area: "General", hours: 1 }), "Add 1 hour labour to General");
    expect(r).toMatchObject({ action: "set_labour_hours", args: { area: "General", hours: 1, mode: "add" } });
    expect(known(r.action)).toBe(true);
    expect(gateDecision(r.action!, r.confidence, draft).kind).toBe("run");
  });
  it("Set the Samsung price to 8000 → floor refusal", () => {
    const r = route(R("set_qty", { item: "Samsung", qty: 8000 }), "Set the Samsung price to 8000");
    expect(r).toMatchObject({ action: "set_line_price", args: { item: "Samsung", price: 8000 } });
    const unit = { id: "U", area_id: "B1", item_name: "Samsung 12K INV MW", unit_price: 9738.26, quantity: 1, metadata: { unit_cost: 7790.61, markup_percent: 25 } };
    expect(linePriceDecision(unit as any, 8000, { units: 25, materials: 100 }).kind).toBe("refuse");
  });
  it("Move the kit to General, then Move it back", () => {
    const a = route(R("move_item", { item: "the kit", area: "General" }), "Move the kit to General");
    expect(a).toMatchObject({ action: "move_item", args: { item: "the kit", area: "General" } });
    const b = route(R("move_item", { item: "it", area: "Bedroom 1" }), "Move it back");
    expect(b).toMatchObject({ action: "move_item", args: { item: "it", area: "back" } });
  });
  it("Duplicate Bedroom 1 as Bedroom 2 copies lines", () => {
    const r = route(R("add_area", { name: "Bedroom 2" }), "Duplicate Bedroom 1 as Bedroom 2");
    expect(r).toMatchObject({ action: "duplicate_area", args: { area: "Bedroom 1", new_name: "Bedroom 2" } });
    expect(duplicateAreaRows([goodKit as EditItem], "B1")).toHaveLength(1);
  });
  it("Describe Lounge as north-facing wall", () => {
    expect(route(R("rename_area", { area: "Lounge", new_name: "north-facing wall" }), "Describe Lounge as north-facing wall"))
      .toMatchObject({ action: "describe_area", args: { area: "Lounge", description: "north-facing wall" } });
  });
  it("Add a note to the quote: access via side gate", () => {
    expect(route(R("add_area", { name: "access via side gate" }), "Add a note to the quote: access via side gate"))
      .toMatchObject({ action: "add_note", args: { target: "quote", text: "access via side gate" } });
  });
  it("Remove the Samsung in Lounge → Confirm", () => {
    const r = route(R("remove_item", { item: "the Samsung in Lounge" }), "Remove the Samsung in Lounge");
    expect(r.action).toBe("remove_item");
    expect(CONFIRM_REQUIRED.has("remove_item")).toBe(true);
    expect(gateDecision("remove_item", 0.99, draft).kind).toBe("confirm");
    const hits = matchQuoteItem([{ id: "U", area_id: "L", item_name: "Samsung 12K" } as any], [{ id: "L", name: "Lounge" }], "the Samsung in Lounge").hits;
    expect(hits.map((h) => h.id)).toEqual(["U"]);
  });
  it("Bedroom 3 multi-edit → one plan card", () => {
    const steps = [
      { action: "add_item_to_area", args: { area: "Bedroom 3", query: "12K Samsung" } },
      { action: "set_kit_length", args: { area: "Bedroom 3", metres: 3 } },
      { action: "set_labour_hours", args: { area: "Bedroom 3", hours: 2 } },
    ];
    const r = route(R("run_plan", { steps }), "Bedroom 3: add a 12K Samsung with 3 m kit and 2 hours labour");
    expect(r.action).toBe("run_plan");
    expect(r.plan).toHaveLength(3);
    expect(gatePlan(r.plan!, r.confidence, draft).kind).toBe("confirm");
  });
  it("Add a 12K Samsung → area chips", () => {
    const r = route(R("add_item_to_area", { query: "12K Samsung" }), "Add a 12K Samsung");
    expect(r.action).toBe("add_item_to_area");
    expect(r.args.area).toBeUndefined();
    expect(acNeedsAreaPick(true, null, undefined)).toBe(true);
    expect(areaChipsForAdd([{ name: "General" }, { name: "Bedroom 1" }], { product_id: "p", quantity: 1 }).length).toBe(3);
  });
});
