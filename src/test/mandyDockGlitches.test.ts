import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { renameAreaDecision, resolveAreaWord } from "@/lib/mandy/itemResolve";
import { parseLabourHours } from "@/lib/mandy/labourParse";
import { runSetLabourHours } from "@/lib/mandy/labourAction";
import { runInstallEdit, lengthsFromRequest, qtyPhrase } from "@/lib/mandy/installEdits";
import { kitForSizes, pickKitForUnit } from "@/lib/kitSizes";

const A = (name: string, id = name) => ({ id, name });

describe("rename_area resolver", () => {
  it("'General' on a one-area quote → that area", () => {
    const d = renameAreaDecision([A("Area 1")], "General", "Lounge");
    expect(d.kind === "rename" && d.area.name).toBe("Area 1");
  });
  it("'1st area' → first area", () => {
    expect(resolveAreaWord([A("Main bedroom"), A("Bedroom 2")], "1st area")?.name).toBe("Main bedroom");
    expect(resolveAreaWord([A("Main bedroom"), A("Bedroom 2")], "second room")?.name).toBe("Bedroom 2");
  });
  it("unknown word, only one area → rename it", () => {
    expect(renameAreaDecision([A("Items")], "kitchen", "Lounge").kind).toBe("rename");
  });
  it("zero areas → create", () => {
    expect(renameAreaDecision([], "General", "Lounge").kind).toBe("create");
  });
  it("several areas, no match → choices, never a bare error", () => {
    const d = renameAreaDecision([A("Main bedroom"), A("Bedroom 2")], "General", "Lounge");
    expect(d.kind).toBe("choices");
    if (d.kind === "choices") {
      expect(d.message).toBe("Which room should become Lounge? You have: Main bedroom, Bedroom 2.");
      expect(d.choices.map((c) => c.args)).toEqual([{ area: "Main bedroom", new_name: "Lounge" }, { area: "Bedroom 2", new_name: "Lounge" }]);
    }
  });
});

describe("labour hours parser", () => {
  it.each([
    ["add to hours labour", 2], ["an hour and a half", 1.5], ["half an hour", 0.5], ["three hours", 3],
    ["add 2 hours", 2], ["one and a half", 1.5], ["1 and a half hours", 1.5], ["two and a half", 2.5], ["an hour", 1], ["add labour please", null],
    ["add labour to bedroom 2", null], ["add labour to lounge", null],
  ])("%s → %s", (t, n) => expect(parseLabourHours(t)).toBe(n));

  it("no hours anywhere → one natural question with hour chips for the only area", async () => {
    const r = await runSetLabourHours({ areas: [A("Lounge")], items: [], standardRate: 500, addItem: vi.fn(), updateItem: vi.fn() }, { mode: "add", __utterance: "add labour" });
    expect(r.message).toBe("How many hours of labour should I add to Lounge?");
    expect(r.choices?.map((c) => c.args.hours)).toEqual([1, 1.5, 2, 3]);
    expect(r.choices?.[0].args).toMatchObject({ area: "Lounge", mode: "add" });
  });
  it("hours dropped by the model are read from the utterance", async () => {
    const addItem = vi.fn().mockResolvedValue({ id: "x" });
    const r = await runSetLabourHours({ areas: [A("Lounge")], items: [], standardRate: 500, addItem, updateItem: vi.fn() }, { mode: "add", __utterance: "add to hours labour" });
    expect(r.ok).toBe(true);
    expect(r.data?.new_hours).toBe(2);
  });
});

const copper = (s: string) => ({ product: { id: s, short_name: `Copper ${s}` } });
const K = (id: string, name: string, a: string, b: string, min?: number, max?: number) => ({ id, name: `PIPING KIT ${name}`, items: [copper(a), copper(b)], min_btu: min ?? null, max_btu: max ?? null });

describe("kit swap tie-break", () => {
  const kits = [K("k12", "12K 1/4 & 1/2", "1/4", "1/2"), K("k18", "18K 1/4 & 1/2", "1/4", "1/2")];
  it("24K + 1/4,1/2 → 18K kit (same rule as pickKitForUnit)", () => {
    expect(pickKitForUnit(kits as any, { pipe_liquid: "1/4", pipe_gas: "1/2" }, { btuOf: () => 24000 }).kit?.id).toBe("k18");
    expect(kitForSizes(kits as any, ["1/2", "1/4"], 24000)?.id).toBe("k18");
  });
});

describe("edit_install no-ops", () => {
  const unit = { id: "u", item_name: "Samsung 24K", area_id: "a", product_id: null };
  const tag = (role: string) => ({ install: { unit_item_id: "u", role, template_id: "t" } });
  const items = [
    unit,
    { id: "kit", item_name: "PIPING KIT 18K 1/4 & 1/2", length: 3, metadata: { ...tag("piping_kit"), kit: { bundle_id: "k18" } } },
    { id: "br", item_name: "Bracket 650mm", item_number: "BRAC05", quantity: 1, unit_price: 550, total_price: 550, metadata: tag("bracket") },
    { id: "tr", item_name: "Trunking 100x40", item_number: "TRUNK01", quantity: 1, unit_price: 264.5, total_price: 264.5, metadata: { ...tag("trunking_main"), supplier_length_m: 3 } },
  ];
  const deps = () => ({ items: items as any, areaName: () => "Lounge", liveProducts: [{ id: "p", product_code: "BRAC05" }], addItem: vi.fn(), updateItem: vi.fn(), deleteItem: vi.fn(), bundles: [] });

  it("same bracket → no write", async () => {
    const d = deps();
    const r = await runInstallEdit(d, { op: "bracket", size: "650" });
    expect(d.updateItem).not.toHaveBeenCalled();
    expect(r.message).toMatch(/already has the 650 mm bracket \(BRAC05, R550\), so nothing changed/);
  });
  it("same kit sizes → no write", async () => {
    const d = deps();
    const r = await runInstallEdit(d, { op: "kit_swap", sizes: ["1/2", "1/4"] });
    expect(d.updateItem).not.toHaveBeenCalled();
    expect(r.message).toBe("The kit is already 1/4 + 1/2, 3 m, so nothing changed.");
  });
  it("same trunking qty → no write", async () => {
    const d = deps();
    const r = await runInstallEdit(d, { op: "set_qty", role: "trunking_main", qty: 1 });
    expect(d.updateItem).not.toHaveBeenCalled();
    expect(r.message).toMatch(/already 1 × 3 m length \(3 m\), so nothing changed/);
  });
  it("metres → lengths with both read back", async () => {
    const d = deps();
    const r = await runInstallEdit(d, { op: "set_qty", role: "trunking_main", metres: 1.5 } as any);
    expect(d.updateItem).toHaveBeenCalledWith("tr", { quantity: 0.5, total_price: 132.25 });
    expect(r.message).toMatch(/now half a 3 m length \(1\.5 m\), R132,25/);
  });
});

describe("metres → lengths", () => {
  it("1.5 m → 0.5 length (arg or utterance)", () => {
    expect(lengthsFromRequest({ metres: 1.5 }, "", 3)).toBe(0.5);
    expect(lengthsFromRequest({ qty: 1.5 }, "make the trunking 1.5 m", 3)).toBe(0.5);
    expect(lengthsFromRequest({ qty: 2 }, "two lengths of trunking", 3)).toBe(2);
    expect(qtyPhrase(0.5, 3)).toBe("half a 3 m length (1.5 m)");
  });
});

describe("count-role set_qty read-back", () => {
  it("end caps (no supplier length) → 'End cap: now 2, R59,04'", async () => {
    const unit = { id: "u", item_name: "Samsung 24K", area_id: "a", product_id: null };
    const items = [unit, { id: "ec", item_name: "End Cap", item_number: "EC01", quantity: 1, unit_price: 29.52, total_price: 29.52, metadata: { install: { unit_item_id: "u", role: "trunking_endcap", template_id: "t" } } }];
    const d = { items: items as any, areaName: () => "Lounge", liveProducts: [], addItem: vi.fn(), updateItem: vi.fn().mockResolvedValue(true), deleteItem: vi.fn(), bundles: [] };
    const r = await runInstallEdit(d, { op: "set_qty", role: "trunking_endcap", qty: 2 });
    expect(d.updateItem).toHaveBeenCalledWith("ec", { quantity: 2, total_price: 59.04 });
    expect(r.message).toBe("End cap: now 2, R59,04.");
  });
});
