import { describe, it, expect } from "vitest";
import { parseInstallCommand, runInstallEdit, announceInstall, unitsWithInstall } from "@/lib/mandy/installEdits";
import { parseQuoteIntent } from "@/lib/mandy/quoteIntent";
import { parseLabourIntent } from "@/lib/mandy/labourParse";

const tag = (unit: string, role: string) => ({ install: { unit_item_id: unit, role, template_id: "t" } });
const p = (code: string, name: string, cost: number, extra: any = {}) => ({ id: code, product_code: code, short_name: name, product_category: "Consumables", category: "Consumables", cost_price: cost, cost_excl_vat: cost, default_markup_percent: 100, supplier_name: "X", ...extra });
const live = [p("BRAC01", "Bracket 450mm", 210), p("BRAC02", "Bracket 550mm", 225), p("BRAC15", "Flatback Bracket 550mm", 335), p("TRUNKCAP01", "End Cap", 14.76), p("ELB001", "Elbow", 3.75)];

const base = () => [
  { id: "u1", item_name: "Samsung 12K", area_id: "a1", quantity: 1, unit_price: 11000, metadata: {} },
  { id: "k1", item_name: "12K kit", area_id: "a1", quantity: 1, length: 3, unit_price: 1500, total_price: 1500, is_bundle: true, metadata: { ...tag("u1", "piping_kit"), unit_cost: 750, markup_percent: 100, kit: { unit_cost: 250, unit_sell: 500 } } },
  { id: "b1", item_name: "Bracket 450mm", item_number: "BRAC01", area_id: "a1", quantity: 1, unit_price: 420, metadata: tag("u1", "bracket") },
  { id: "d1", item_name: "Drain", item_number: "DPIPE01", area_id: "a1", quantity: 1, unit_price: 112, metadata: { ...tag("u1", "drain_pipe"), supplier_length_m: 4 } },
  { id: "e1", item_name: "Elbow", item_number: "ELB001", area_id: "a1", quantity: 3, unit_price: 7.5, metadata: tag("u1", "drain_bend") },
];

function deps(items: any[]) {
  const log: any[] = [];
  return {
    log,
    d: {
      items, areaName: () => "General", liveProducts: live,
      addItem: async (r: any) => { log.push(["add", r]); return { ...r, id: "new" }; },
      updateItem: async (id: string, patch: any) => { log.push(["upd", id, patch]); return true; },
      deleteItem: async (id: string) => { log.push(["del", id]); return true; },
    },
  };
}

describe("install phrase parser", () => {
  it.each([
    ["make the piping 3 metres", { op: "kit_length", metres: 3 }],
    ["use a 550 bracket", { op: "bracket", size: "550" }],
    ["flatback bracket", { op: "bracket", flatback: true }],
    ["no drain", { op: "remove_roles", roles: ["drain_pipe", "drain_bend"], what: "drain" }],
    ["add a bend", { op: "add_bend" }],
    ["2 end caps", { op: "set_qty", role: "trunking_endcap", qty: 2 }],
    ["two lengths of 100 by 40", { op: "set_qty", role: "trunking_main", qty: 2 }],
    ["install without trunking", { op: "remove_roles", roles: ["trunking_main", "trunking_endcap", "trunking_small"], what: "trunking" }],
  ])("%s", (t, want) => expect(parseInstallCommand(t)).toEqual(want));
  it("does not grab normal edits", () => {
    expect(parseInstallCommand("add a Samsung 12000 to bedroom 1")).toBeNull();
    expect(parseInstallCommand("set labour to 4 hours")).toBeNull();
  });
  it("earlier routers don't steal install phrases", () => {
    // The dock checks parseInstallCommand before parseQuoteIntent, so only labour must stay clear.
    for (const t of ["no drain", "use a 550 bracket", "2 end caps", "add a bend", "remove the small trunking"]) {
      expect(parseLabourIntent(t)).toBeNull();
      expect(parseInstallCommand(t)).not.toBeNull();
    }
    expect(parseQuoteIntent("no drain")).toBeNull();
  });
});

describe("runInstallEdit", () => {
  it("550 bracket swaps BRAC01 → BRAC02 at catalog sell, tag kept", async () => {
    const { d, log } = deps(base());
    const r = await runInstallEdit(d, { op: "bracket", size: "550" });
    expect(r.ok).toBe(true);
    const [, id, patch] = log[0];
    expect(id).toBe("b1");
    expect(patch.item_number).toBe("BRAC02");
    expect(patch.unit_price).toBeCloseTo(450, 2);
    expect(patch.metadata.install.role).toBe("bracket");
  });
  it("flatback on BRAC02 → BRAC15", async () => {
    const items = base(); items[2] = { ...items[2], item_number: "BRAC02" };
    const { d, log } = deps(items);
    await runInstallEdit(d, { op: "bracket", flatback: true });
    expect(log[0][2].item_number).toBe("BRAC15");
  });
  it("kit length reprices from per-metre sell", async () => {
    const { d, log } = deps(base());
    const r = await runInstallEdit(d, { op: "kit_length", metres: 5 });
    expect(log[0][2].unit_price).toBeCloseTo(2500, 2);
    expect(r.message).toContain("5 m");
  });
  it("add a bend → elbows 3 → 4", async () => {
    const { d, log } = deps(base());
    await runInstallEdit(d, { op: "add_bend" });
    expect(log[0][2].quantity).toBe(4);
    expect(log[0][2].total_price).toBeCloseTo(30, 2);
  });
  it("2 end caps adds TRUNKCAP01 tagged to the unit when missing", async () => {
    const { d, log } = deps(base());
    await runInstallEdit(d, { op: "set_qty", role: "trunking_endcap", qty: 2 });
    expect(log[0][0]).toBe("add");
    expect(log[0][1].quantity).toBe(2);
    expect(log[0][1].metadata.install).toMatchObject({ unit_item_id: "u1", role: "trunking_endcap" });
    expect(log[0][1].parent_item_id).toBeNull();
  });
  it("no drain → Confirm card; nothing deleted until run", async () => {
    const { d, log } = deps(base());
    const r = await runInstallEdit(d, { op: "remove_roles", roles: ["drain_pipe", "drain_bend"], what: "drain" });
    expect(r.confirm?.lines.length).toBe(2);
    expect(log.length).toBe(0);
    await r.confirm!.run();
    expect(log.map((x) => x[1])).toEqual(["d1", "e1"]);
  });
  it("two units → chips, no write", async () => {
    const items = [...base(), { id: "u2", item_name: "Samsung 18K", area_id: "a2", quantity: 1, unit_price: 15000, metadata: {} },
      { id: "b2", item_name: "Bracket", item_number: "BRAC01", area_id: "a2", quantity: 1, unit_price: 420, metadata: tag("u2", "bracket") }];
    expect(unitsWithInstall(items as any).length).toBe(2);
    const { d, log } = deps(items);
    const r = await runInstallEdit(d, { op: "bracket", size: "550" });
    expect(r.choices?.length).toBe(2);
    expect(r.choices![1].args.unit_item_id).toBe("u2");
    expect(log.length).toBe(0);
  });
  it("code not live → honest refusal", async () => {
    const { d } = deps(base());
    const r = await runInstallEdit(d, { op: "bracket", size: "650" });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/not in the active price books/);
  });
});

describe("announceInstall", () => {
  it("summarises unit + install in one sentence", () => {
    const items = base();
    const msg = announceInstall("Samsung 12K", { line: items[0], kit: items[1], kitLength: 3, installLines: items.slice(2) as any, notes: [] }, "General");
    expect(msg).toMatch(/^Added Samsung 12K to General with standard install: 3 m kit, 450 bracket, drain, 3 elbows — R/);
  });
});
