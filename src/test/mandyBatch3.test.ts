import { describe, it, expect } from "vitest";
import { captureSnapshot, stateHash, undoDecision, planRestore, MANUAL_EDIT_REFUSAL, type QuoteSnapshot } from "@/lib/mandy/undo";
import { qtyPatch, runPlanSteps, linkKitSteps, type EditItem } from "@/lib/mandy/quoteEdits";
import { quoteTotals, previewPlan } from "@/lib/mandy/planPreview";
import { matchCatalog, normaliseSpokenProduct, catalogChipLabel } from "@/lib/mandy/catalogMatch";
import { guardRoute, postProcessRoute } from "@/lib/mandy/router";
import { gateDecision } from "@/lib/mandy/gate";
import { parseMultiEdit } from "@/lib/mandy/multiEdit";
import { setActiveQuoteMarkupRates } from "@/lib/pricing";
import { kitLengthPatch } from "@/lib/mandy/quoteOps";
import { undoLabel } from "@/components/mandy/MandyQuoteActions";

/* ───── fixtures (TEST quote Q-2026-0014 shape) ───── */
const areas = [{ id: "aG", name: "General", description: null, sort_order: 0 }, { id: "aB", name: "Bedroom 1", description: null, sort_order: 1 }];
const items: EditItem[] = [
  { id: "lab", area_id: "aG", parent_item_id: null, product_id: null, item_name: "General labour", quantity: 3, unit_price: 680, total_price: 2040, is_bundle: false, item_type: "labour", sort_order: 0, metadata: { labour: true, hours: 3, rate: 680, total_cost: 2040 } } as any,
  { id: "sam", area_id: "aB", parent_item_id: null, product_id: "P12", item_name: "Samsung 12K INV MW", quantity: 1, unit_price: 9738.26, total_price: 9738.26, is_bundle: false, item_type: "product", sort_order: 1, metadata: { unit_cost: 7790.61, markup_percent: 25 } } as any,
  { id: "kit", area_id: "aB", parent_item_id: null, product_id: null, item_name: "12K INV 1/4&1/2 PIPING KIT", quantity: 1, length: 1, unit_price: 364.1, total_price: 364.1, is_bundle: true, item_type: "Installation Kit", sort_order: 2, metadata: { unit_cost: 182.05, markup_percent: 100, kit: { unit_cost: 182.05, unit_sell: 364.1 } } } as any,
];
type St = { notes: string | null; areas: any[]; items: any[] };
const clone = (s: St): St => JSON.parse(JSON.stringify(s));
const hashOf = (s: St) => stateHash(s.notes, s.areas, s.items);
/** Apply a RestorePlan to an in-memory state (what the builder save path does to the rows). */
function applyRestore(cur: St, snap: QuoteSnapshot): St {
  const p = planRestore(snap, cur);
  let it = cur.items.filter((i) => !p.deleteItems.includes(i.id));
  let ar = cur.areas.filter((a) => !p.deleteAreas.includes(a.id));
  ar = [...ar.map((a) => p.updateAreas.find((u) => u.id === a.id) || a), ...p.insertAreas];
  it = [...it.map((i) => p.updateItems.find((u) => u.id === i.id) || i), ...p.insertItems];
  return { notes: p.notesChanged ? snap.quote.notes : cur.notes, areas: ar, items: it };
}
function mandyChange(s0: St, change: (s: St) => void) {
  const snapshot = captureSnapshot({ notes: s0.notes }, s0.areas, s0.items);
  const s1 = clone(s0); change(s1);
  return { snapshot, after: s1, snapRow: { state_hash_after: hashOf(s1) } };
}
const base: St = { notes: null, areas, items: items as any[] };

describe("D: undo last Mandy change", () => {
  it("after set_qty: restored exactly, totals exact", () => {
    const { snapshot, after, snapRow } = mandyChange(base, (s) => {
      const p = qtyPatch(s.items[1] as EditItem, 2);
      Object.assign(s.items[1], p.patch);
    });
    expect(quoteTotals(after.items, 0.15).excl).not.toBeCloseTo(12142.36, 2);
    expect(undoDecision({ status: "draft", snap: snapRow, currentHash: hashOf(after) })).toEqual({ ok: true });
    const back = applyRestore(after, snapshot);
    expect(hashOf(back)).toBe(hashOf(base));
    expect(quoteTotals(back.items, 0.15)).toEqual({ excl: 12142.36, incl: 13963.71 });
  });

  it("after a plan (area + unit + labour) as one unit", () => {
    const { snapshot, after, snapRow } = mandyChange(base, (s) => {
      s.areas.push({ id: "a3", name: "Bedroom 3", description: null, sort_order: 2 });
      s.items.push({ ...s.items[1], id: "sam3", area_id: "a3" }, { ...s.items[2], id: "kit3", area_id: "a3", length: 3, unit_price: 1092.3, total_price: 1092.3 });
      Object.assign(s.items[0], { quantity: 5, total_price: 3400 });
    });
    expect(undoDecision({ status: "draft", snap: snapRow, currentHash: hashOf(after) }).ok).toBe(true);
    const back = applyRestore(after, snapshot);
    expect(back.areas.map((a) => a.name).sort()).toEqual(["Bedroom 1", "General"]);
    expect(hashOf(back)).toBe(hashOf(base));
    expect(quoteTotals(back.items, 0.15).incl).toBe(13963.71);
  });

  it("after remove_item (unit + kit): lines re-inserted with the same ids and prices", () => {
    const { snapshot, after } = mandyChange(base, (s) => { s.items = s.items.filter((i) => i.id === "lab"); });
    const back = applyRestore(after, snapshot);
    expect(back.items.map((i) => i.id).sort()).toEqual(["kit", "lab", "sam"]);
    expect(back.items.find((i) => i.id === "sam")!.unit_price).toBe(9738.26);
    expect(quoteTotals(back.items, 0.15)).toEqual({ excl: 12142.36, incl: 13963.71 });
  });

  it("consecutive undos chain while still valid", () => {
    const c1 = mandyChange(base, (s) => { s.notes = "access via side gate"; });
    const c2 = mandyChange(c1.after, (s) => { s.items[0].quantity = 4; s.items[0].total_price = 2720; });
    const b1 = applyRestore(c2.after, c2.snapshot);
    expect(undoDecision({ status: "draft", snap: c1.snapRow, currentHash: hashOf(b1) }).ok).toBe(true);
    expect(hashOf(applyRestore(b1, c1.snapshot))).toBe(hashOf(base));
  });

  it("refused after a manual edit and on non-drafts", () => {
    const { after, snapRow } = mandyChange(base, (s) => { s.items[0].quantity = 4; });
    const hand = clone(after); hand.items[1].unit_price = 9000;
    expect(undoDecision({ status: "draft", snap: snapRow, currentHash: hashOf(hand) })).toEqual({ ok: false, message: MANUAL_EDIT_REFUSAL });
    const handArea = clone(after); handArea.areas[1].name = "Main bedroom";
    expect(undoDecision({ status: "draft", snap: snapRow, currentHash: hashOf(handArea) }).ok).toBe(false);
    expect(undoDecision({ status: "sent", snap: snapRow, currentHash: hashOf(after) }).ok).toBe(false);
    expect(gateDecision("undo_last_change", 0.9, { quoteStatus: "accepted" }).kind).toBe("block");
    expect(gateDecision("undo_last_change", 0.9, { quoteStatus: "draft" }).kind).toBe("run");
    expect(undoDecision({ status: "draft", snap: null, currentHash: "x" }).ok).toBe(false);
  });

  it("router: undo phrases", () => {
    for (const t of ["undo", "Undo that", "take that back", "revert the last change"]) {
      expect(guardRoute({ action: "remove_item", args: {}, confidence: 0.6 }, t).action).toBe("undo_last_change");
    }
    expect(undoLabel("Added area Bedroom 3.")).toBe("added area Bedroom 3");
  });
});

/* ───── F: catalog matcher ───── */
const comp = (code: string, cost: number, ppm: number, len: number) => ({
  quantity: 1, length_metres: 1, is_length_item: true, is_optional: false,
  product: { id: code, product_code: code, short_name: code, product_category: "Consumables", category: "Consumables", cost_price: cost, cost_excl_vat: cost, price_per_metre: ppm, sold_in_length: true, unit_length: len, default_markup_percent: 100 },
});
const kits = [
  { id: "k12", name: "12K INV 1/4&1/2 PIPING KIT", items: [comp("COPRL001", 600, 39.37, 15.24), comp("COPRL003", 1100, 72.18, 15.24)] },
  { id: "k24", name: "24K INV 1/4&5/8 PIPING KIT", items: [] },
];
const ac = { product_category: "Air Conditioning", category: "Air Conditioning", brand: "Samsung", supplier_type: "ac_units", default_markup_percent: 25, markup_percent: 25, pdf_upload_id: "pdf1", archived: false, description: "" };
const catalog: any[] = [
  { ...ac, id: "P12", product_code: "AR40F12C0AG/FA", short_name: "Samsung 12K INV MW", cost_price: 7790.608, cost_excl_vat: 7790.608, search_aliases: ["windfree 12"] },
  { ...ac, id: "P18", product_code: "AR40F18C0AG/FA", short_name: "Samsung 18K INV MW", cost_price: 10500, cost_excl_vat: 10500 },
  { ...ac, id: "L12", brand: "LG", product_code: "S4NQ12JA3WC", short_name: "LG 12K INV Dualcool", cost_price: 7000, cost_excl_vat: 7000 },
  { ...ac, id: "OLD", product_code: "AR40F12OLD", short_name: "Samsung 12K INV old", cost_price: 1, archived: true },
  { ...ac, id: "NOPDF", product_code: "AR40F12NOPDF", short_name: "Samsung 12K INV nopdf", cost_price: 1, pdf_upload_id: null },
];

describe("F: shared catalog matcher", () => {
  it("normalises shorthand", () => {
    for (const q of ["12K", "12 k", "12000", "12 000 BTU", "twelve thousand"]) expect(normaliseSpokenProduct(q)).toBe("12k");
    expect(normaliseSpokenProduct("inverter")).toBe("inv");
  });
  it("'12K Samsung' and '12 000 BTU Samsung' → the one live Samsung 12K", () => {
    for (const q of ["12K Samsung", "12 000 BTU Samsung"]) {
      const m = matchCatalog(q, catalog, kits);
      expect(m.pick?.id).toBe("P12");
    }
  });
  it("'AR40' → model prefix; archived / no-PDF rows never match", () => {
    const m = matchCatalog("AR40", catalog, kits);
    expect(m.ranked.map((h) => h.id).sort()).toEqual(["P12", "P18"]); // two live AR40s → chips
    expect(m.pick).toBeNull();
    expect(matchCatalog("AR40F12", catalog).pick?.id).toBe("P12");
  });
  it("'twelve thousand BTU inverter' → 12K INV only, close scores → 2 chips", () => {
    const m = matchCatalog("twelve thousand BTU inverter", catalog, kits);
    expect(m.pick).toBeNull();
    expect(m.options.map((h) => h.id).sort()).toEqual(["L12", "P12"]);
    const label = catalogChipLabel(m.options.find((h) => h.id === "P12")!, 9738.26);
    expect(label.replace(/\s/g, " ")).toBe("Samsung 12K INV MW · AR40F12C0AG/FA · R 9 738,26 excl. VAT");
  });
  it("'piping bundle' with a 12K unit in the area → the 12K kit", () => {
    const m = matchCatalog("piping bundle", catalog, kits, { areaBtu: 12000 });
    expect(m.pick?.kind).toBe("kit");
    expect(m.pick?.id).toBe("k12");
    expect(matchCatalog("install kit", catalog, kits).pick).toBeNull(); // no size known → chips
  });
  it("ambiguous query gives 2–3 chips, never an auto-pick", () => {
    const m = matchCatalog("Samsung inverter", catalog, kits);
    expect(m.pick).toBeNull();
    expect(m.options.length).toBeGreaterThanOrEqual(2);
    expect(m.options.length).toBeLessThanOrEqual(3);
  });
  it("aliases are searched", () => {
    expect(matchCatalog("windfree 12", catalog).pick?.id).toBe("P12");
  });
});

describe("replay: 'Bedroom 1: add an AR40 with 3 m kit'", () => {
  const S = "Bedroom 1: add an AR40 with 3 m kit";
  it("becomes one plan; the model pick keeps the plan; kit 3 m = R1 092.30", async () => {
    const rates = { unitsMarkupPercent: 25, materialsMarkupPercent: 100 } as any;
    setActiveQuoteMarkupRates(rates);
    const r = postProcessRoute({ action: "add_item_to_area", args: { query: "AR40" }, confidence: 0.9 }, S);
    expect(r.action).toBe("run_plan");
    expect(r.plan).toEqual(parseMultiEdit(S));
    expect(r.plan).toEqual([
      { action: "add_area", args: { name: "Bedroom 1" } },
      { action: "add_item_to_area", args: { area: "Bedroom 1", query: "AR40" } },
      { action: "set_kit_length", args: { area: "Bedroom 1", metres: 3, kitOf: 1 } },
    ]);
    const deps = { items: [items[0]], areas, products: catalog, bundles: kits as any, rates, standardRate: 680, vatRate: 0.15 };
    const p1 = await previewPlan(r.plan!, deps);
    expect(p1.pick?.options.map((o) => o.id).sort()).toEqual(["P12", "P18"]);
    const steps = r.plan!.map((s, i) => (i === p1.pick!.step ? { ...s, args: { ...s.args, product_id: "P12" } } : s));
    const p2 = await previewPlan(steps, deps);
    expect(p2.error).toBeUndefined();
    expect(p2.lines.find((l) => l.action === "add_item_to_area")!.price).toBeCloseTo(9738.26, 2);
    const auto = p2.lines.find((l) => l.action === "auto_kit")!;
    expect(p2.lines.find((l) => l.action === "set_kit_length")!.price).toBeCloseTo(auto.price! * 3, 1);
    // On the real 12K kit (cost R182.05/m, 100%): 3 m = R1 092.30.
    expect(kitLengthPatch(items[2] as any, 3).unit_price).toBeCloseTo(1092.3, 2);
  });
});

describe("plan kit step targets the kit its own add step created", () => {
  const S = "Bedroom 1: add an AR40 with 3 m kit";
  const rates = { unitsMarkupPercent: 25, materialsMarkupPercent: 100 } as any;
  // A 12K kit at R182.05/m cost (100% materials → R364.10/m).
  const kit12 = [{ id: "k12", name: "12K INV 1/4&1/2 PIPING KIT", items: [comp("KIT12", 182.05, 182.05, 1)] }];
  const deps = () => ({ items: items.map((i) => ({ ...i })), areas, products: catalog, bundles: kit12 as any, rates, standardRate: 680, vatRate: 0.15 });

  for (const grok of [{ query: "AR40" }, { query: "AR40", area: "Bedroom 1" }]) {
    it(`Grok ${JSON.stringify(grok)} → one card; new kit 3 m = R1 092.30; existing 1 m kit untouched`, async () => {
      setActiveQuoteMarkupRates(rates);
      const r = postProcessRoute({ action: "add_item_to_area", args: grok, confidence: 0.9 }, S);
      expect(r.action).toBe("run_plan");
      expect(r.plan![2]).toEqual({ action: "set_kit_length", args: { area: "Bedroom 1", metres: 3, kitOf: 1 } });
      const d = deps();
      const p1 = await previewPlan(r.plan!, d);
      const steps = r.plan!.map((s, i) => (i === p1.pick!.step ? { ...s, args: { ...s.args, product_id: "P12" } } : s));
      const p2 = await previewPlan(steps, d);
      expect(p2.error).toBeUndefined();
      expect(p2.lines.find((l) => l.action === "add_item_to_area")!.price).toBeCloseTo(9738.26, 2);
      expect(p2.lines.find((l) => l.action === "set_kit_length")!.price).toBeCloseTo(1092.3, 2);
      expect(d.items.find((i) => i.id === "kit")).toMatchObject({ length: 1, unit_price: 364.1 });
      // New unit 9 738.26 + new kit 1 092.30 on top of 12 142.36.
      expect(p2.afterExcl).toBeCloseTo(12142.36 + 9738.26 + 1092.3, 2);
    });
  }

  it("execute passes the add step's kit_id and drops the area search", async () => {
    const seen: any[] = [];
    const rep = await runPlanSteps(parseMultiEdit(S)!.map((s, i) => (i === 1 ? { ...s, args: { ...s.args, product_id: "P12" } } : s)), async (s) => {
      seen.push(s);
      return s.action === "add_item_to_area" ? { ok: true, message: "added", data: { kit_id: "NEWKIT" } } : { ok: true, message: "ok" };
    });
    expect(rep.failedAt).toBeNull();
    expect(seen[2].args).toEqual({ metres: 3, kit_id: "NEWKIT" });
  });

  it("no add step → kit step still searches the area", () => {
    expect(linkKitSteps([{ action: "set_kit_length", args: { area: "Bedroom 1", metres: 3 } }])[0].args.kitOf).toBeUndefined();
  });
});
