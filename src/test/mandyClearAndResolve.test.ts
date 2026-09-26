import { describe, it, expect, vi } from "vitest";
import { resolveItemRef, normText, findAreaFuzzy, noMatchMessage } from "@/lib/mandy/itemResolve";
import { parseQuoteIntent, clearRefusal, clearSummary, areasToRemove, isClearQuote } from "@/lib/mandy/quoteIntent";
import { runSetLabourHours, buildRemoveLabour } from "@/lib/mandy/labourAction";
import { planRestore, captureSnapshot } from "@/lib/mandy/undo";
import { quoteLinesContext } from "@/lib/mandy/quoteLinesContext";
import { guardQuoteWrites, withWriteFailures } from "@/lib/mandy/writeGuard";

const areas = [{ id: "G", name: "General", sort_order: 0 }, { id: "B1", name: "Bedroom 1", sort_order: 1 }];
const lab = (id: string, area: string, h: number) => ({ id, area_id: area, item_name: "Labour", item_type: "labour", quantity: h, unit_price: 680, total_price: h * 680, metadata: { labour: true, hours: h, rate: 680 }, sort_order: 9 });
const items: any[] = [
  { id: "S", area_id: "B1", item_name: "Samsung 12K INV MW", item_number: "AR40F12C0AG/FA", supplier: "Samsung", quantity: 1, unit_price: 9738.26, total_price: 9738.26, sort_order: 1, metadata: {} },
  { id: "K", area_id: "B1", item_name: "12K INV piping kit", item_number: "KIT-5AE3C7", is_bundle: true, length: 3.5, unit_price: 1274.35, total_price: 1274.35, sort_order: 2, metadata: { kit: {} } },
  lab("LG", "G", 5.5), lab("LB", "B1", 3.5),
];

describe("resolver", () => {
  it("normalises sizes", () => {
    for (const s of ["12000", "12K", "12 k", "twelve thousand", "12k btu", "12 000 BTU"]) expect(normText(s, { bareSizes: true })).toBe("12k");
    expect(normText("24", { bareSizes: true })).toBe("24k");
  });
  it("AR40 12000 → the Samsung", () => { const r = resolveItemRef(items, areas, "the AR40 12000"); expect(r.kind === "one" && r.item.id).toBe("S"); });
  it("12K kit → the kit", () => { const r = resolveItemRef(items, areas, "the 12K kit"); expect(r.kind === "one" && r.item.id).toBe("K"); });
  it("area scoping with spoken numbers", () => {
    expect(findAreaFuzzy(areas, "bedroom one")?.id).toBe("B1");
    const r = resolveItemRef(items, areas, "the Samsung in bedroom one"); expect(r.kind === "one" && r.item.id).toBe("S");
    const r2 = resolveItemRef(items, areas, "the samsung in general"); expect(r2.kind).toBe("none");
  });
  it("several matches → many", () => {
    const two = [...items, { ...items[0], id: "S2", area_id: "G" }];
    const r = resolveItemRef(two, areas, "the AR40 12K"); expect(r.kind).toBe("many");
  });
  it("no match lists the lines", () => {
    const r = resolveItemRef(items, areas, "the daikin"); expect(r.kind).toBe("none");
    expect(noMatchMessage("the daikin", items, areas)).toBe("I couldn't find daikin. On this quote: Samsung 12K INV MW (Bedroom 1), 12K INV piping kit (Bedroom 1), Labour (General, Bedroom 1).");
  });
  it("context includes every line and totals", () => {
    const c = quoteLinesContext({ areas, items, subtotal: 17132.61, total: 19702.5 });
    expect(c).toContain("AR40F12C0AG/FA"); expect(c).toContain("KIT 12K INV piping kit"); expect(c).toContain("Labour 5.5h×R680=R3 740"); expect(c).toContain("total R19 702,50");
  });
});

describe("quote intents", () => {
  it("routes clear phrases", () => {
    for (const p of ["clear the quote", "clear everything", "remove everything", "delete everything", "empty the quote", "start over", "start again", "clean the quote", "wipe the quote", "clean and clear the quote completely and remove everything"])
      expect(parseQuoteIntent(p)?.action, p).toBe("clear_quote");
    expect(isClearQuote("clear the quote and the rooms too")).toEqual({ include_areas: true });
    expect(isClearQuote("remove all areas")).toEqual({ include_areas: true });
  });
  it("bare cancel words cancel only a pending card", () => {
    expect(parseQuoteIntent("start over", { pendingCard: true })?.action).toBe("cancel_pending");
    expect(parseQuoteIntent("clear", { pendingCard: true })?.action).toBe("cancel_pending");
    expect(parseQuoteIntent("clear")).toBeNull();
  });
  it("item / area edits", () => {
    expect(parseQuoteIntent("remove the AR40 12000")).toEqual({ action: "remove_item", args: { item: "the AR40 12000" } });
    expect(parseQuoteIntent("take out the 12K kit")).toEqual({ action: "remove_item", args: { item: "the 12K kit" } });
    expect(parseQuoteIntent("change the AR40 to 2")).toEqual({ action: "set_qty", args: { item: "AR40", qty: 2 } });
    expect(parseQuoteIntent("add an area called study")).toEqual({ action: "add_area", args: { name: "study" } });
    expect(parseQuoteIntent("rename bedroom one to main bedroom")).toEqual({ action: "rename_area", args: { area: "bedroom one", new_name: "main bedroom" } });
    expect(parseQuoteIntent("remove the labour from bedroom one")).toBeNull(); // labour parser owns it
  });
});

describe("clear_quote helpers", () => {
  it("refuses accepted / invoiced / paid", () => {
    expect(clearRefusal("Q-2026-0014", "accepted")).toBe("I can't clear Q-2026-0014 – it's already accepted. Make a revision instead.");
    expect(clearRefusal("Q-2026-0014", "invoiced")).toContain("already invoiced");
    expect(clearRefusal("Q-2026-0014", "draft", { depositPaid: true })).toContain("already paid");
    expect(clearRefusal("Q-2026-0014", "draft", { hasJob: true })).toContain("already accepted");
    expect(clearRefusal("Q-2026-0014", "draft")).toBeNull();
  });
  it("card text", () => {
    expect(clearSummary("Q-2026-0014", { items: 1, labour: 2, kits: 1, areasRemoved: 0 })).toBe("Remove all 1 item, 2 labour rows and 1 kit from Q-2026-0014? Room names are kept.");
    expect(areasToRemove(areas)).toEqual(["B1"]);
  });
  it("undo after a clear restores every row with the same ids", () => {
    const snap = captureSnapshot({ notes: null }, areas, items);
    const p = planRestore(snap, { notes: null, areas, items: [] });
    expect(p.insertItems.map((i) => i.id).sort()).toEqual(["K", "LB", "LG", "S"]);
    expect(p.deleteItems).toEqual([]);
  });
});

describe("labour inference", () => {
  const base = { areas, items, standardRate: 680, addItem: vi.fn(async () => ({})), updateItem: vi.fn(async () => true) };
  it("add with no area and 2 areas → chips", async () => {
    const r = await runSetLabourHours(base, { hours: 2, mode: "add" });
    expect(r.choices?.map((c) => c.label)).toEqual(["General", "Bedroom 1"]);
  });
  it("add with one area → that area", async () => {
    const r = await runSetLabourHours({ ...base, areas: [areas[0]], items: [lab("LG", "G", 5.5)] }, { hours: 2, mode: "add" });
    expect(r.message).toBe("Added 2 hours labour to General, R5 100.");
  });
  it("remove with 2 rows → chips; spoken area number resolves", () => {
    const d = { areas, items, deleteItem: vi.fn(async () => true) };
    expect(buildRemoveLabour(d, {}).choices?.length).toBe(2);
    expect(buildRemoveLabour(d, { area: "bedroom one" }).confirm?.summary).toBe("Remove labour from Bedroom 1?");
  });
});

describe("write failures are visible", () => {
  it("false from QuoteContext → ok:false", async () => {
    const g = guardQuoteWrites({ addItem: async () => null, updateItem: async () => false, addArea: async () => null, updateArea: async () => true, deleteArea: async () => false, deleteItem: async () => false, moveItemToArea: async () => true } as any);
    const hs = withWriteFailures({ x: async () => { await g.deleteItem("a"); return { ok: true, message: "Removed." }; } });
    expect(await hs.x({})).toEqual({ ok: false, message: "Couldn't remove the item — nothing was changed." });
  });
});
