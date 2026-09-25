import { describe, it, expect } from "vitest";
import { isStaleBuild, staleWriteRefusal, useBuildStatus, STALE_WRITE_MESSAGE, BUILD_ID } from "@/lib/buildInfo";
import { finalReplyFrom } from "@/lib/mandy/verify";
import { guardRoute, postProcessRoute, type RouteResult } from "@/lib/mandy/router";
import { resolveItemPronoun, resolveAreaPronoun, touchedPatch } from "@/lib/mandy/pronouns";
import { duplicateAreaRows, type EditItem } from "@/lib/mandy/quoteEdits";
import { acNeedsAreaPick, areaChipsForAdd } from "@/components/mandy/MandyQuoteActions";

const R = (action: string | null, args: Record<string, unknown> = {}, confidence = 0.9): RouteResult => ({ action, args, confidence });

describe("build-id banner", () => {
  it("stale id shows the banner, same id does not", () => {
    expect(isStaleBuild("A", "B")).toBe(true);
    expect(isStaleBuild("A", "A")).toBe(false);
    expect(isStaleBuild("A", null)).toBe(false);
    useBuildStatus.getState().setLatest(BUILD_ID);
    expect(useBuildStatus.getState().stale).toBe(false);
    useBuildStatus.getState().setLatest(BUILD_ID + "x");
    expect(useBuildStatus.getState().stale).toBe(true);
  });
  it("stale client refuses writes but allows reads", () => {
    expect(staleWriteRefusal("add_note", true)).toBe(STALE_WRITE_MESSAGE);
    expect(staleWriteRefusal("run_plan", true)).toBe(STALE_WRITE_MESSAGE);
    expect(staleWriteRefusal("read_quote_total", true)).toBeNull();
    expect(staleWriteRefusal("add_note", false)).toBeNull();
  });
});

describe("reply from result (rule G)", () => {
  it("uses the tool's message, never the LLM paraphrase", () => {
    expect(finalReplyFrom([{ ok: true, message: "Added area Access." }], "Note added.")).toBe("Added area Access.");
    expect(finalReplyFrom([], "Hello.")).toBe("Hello.");
  });
});

describe("router guards", () => {
  it("describe → describe_area", () => {
    const r = guardRoute(R("rename_area", { area: "Lounge", new_name: "north-facing wall" }), "Describe Lounge as north-facing wall");
    expect(r.action).toBe("describe_area");
    expect(r.args).toEqual({ area: "Lounge", description: "north-facing wall" });
  });
  it("note → add_note", () => {
    const r = guardRoute(R("add_area", { name: "access via side gate" }), "Add a note to the quote: access via side gate");
    expect(r.action).toBe("add_note");
    expect(r.args).toEqual({ target: "quote", text: "access via side gate" });
  });
  it("duplicate → duplicate_area", () => {
    const r = guardRoute(R("add_area", { name: "Bedroom 2" }), "Duplicate Bedroom 1 as Bedroom 2");
    expect(r.action).toBe("duplicate_area");
    expect(r.args).toEqual({ area: "Bedroom 1", new_name: "Bedroom 2" });
  });
  it("price → set_line_price", () => {
    const r = guardRoute(R("set_qty", { item: "Samsung", qty: 8000 }), "Set the Samsung price to 8000");
    expect(r.action).toBe("set_line_price");
    expect(r.args).toEqual({ item: "Samsung", price: 8000 });
  });
  it("add N hours → mode add", () => {
    const r = postProcessRoute(R("set_labour_hours", { area: "General", hours: 1 }), "Add 1 hour labour to General");
    expect(r.action).toBe("set_labour_hours");
    expect(r.args).toMatchObject({ area: "General", hours: 1, mode: "add" });
    const s = postProcessRoute(R("set_labour_hours", { area: "General", hours: 3, mode: "add" }), "Make it 3 hours labour in General");
    expect(s.args.mode).toBe("set");
  });
  it("move it back → move_item with pronouns", () => {
    const r = guardRoute(R("move_item", { item: "it", area: "Bedroom 1" }), "move it back");
    expect(r.action).toBe("move_item");
    expect(r.args).toMatchObject({ item: "it", area: "back" });
    const ctx = touchedPatch({ item_id: "line-1", area: "Bedroom 2", from_area: "Bedroom 1" });
    expect(resolveItemPronoun("it", ctx)).toBe("line-1");
    expect(resolveAreaPronoun("back", ctx)).toBe("Bedroom 1");
    expect(resolveItemPronoun("the Samsung", ctx)).toBeNull();
  });
  it("multi-edit sentence stays one plan with labour mode add", () => {
    const steps = [
      { action: "add_item_to_area", args: { area: "Bedroom 3", query: "12K Samsung" } },
      { action: "set_kit_length", args: { area: "Bedroom 3", metres: 3 } },
      { action: "set_labour_hours", args: { area: "Bedroom 3", hours: 2 } },
    ];
    const r = postProcessRoute(R("run_plan", { steps }), "Bedroom 3: add a 12K Samsung with 3 m kit and 2 hours labour");
    expect(r.action).toBe("run_plan");
    expect(r.plan).toHaveLength(3);
    expect(r.plan![2].args.mode).toBe("add");
  });
});

describe("AC add with no area", () => {
  it("asks with area chips, never defaults to General", () => {
    expect(acNeedsAreaPick(true, null, undefined)).toBe(true);
    expect(acNeedsAreaPick(true, null, "Bedroom 3")).toBe(false);
    expect(acNeedsAreaPick(false, null, undefined)).toBe(false);
    const chips = areaChipsForAdd([{ name: "General" }], { product_id: "p1", quantity: 1 });
    expect(chips.some((c) => c.args.area === "General")).toBe(true);
    expect(chips.length).toBeGreaterThan(1); // + New area…
  });
});

describe("duplicate_area copies all lines", () => {
  it("unit + kit + labour with stored prices and metadata", () => {
    const items: EditItem[] = [
      { id: "u", area_id: "A", item_name: "Samsung 12K", unit_price: 9738.26, total_price: 9738.26, quantity: 1, sort_order: 1, metadata: { cost_excl: 7790.61, markup_percent: 25, price_locked: true } },
      { id: "k", area_id: "A", parent_item_id: "u", item_name: "12K kit", is_bundle: true, unit_price: 364.1, quantity: 1, length: 1, sort_order: 2, metadata: { kit: true, components: [{ code: "COPRL001" }] } },
      { id: "l", area_id: "A", item_name: "Labour", item_type: "labour", unit_price: 680, quantity: 2, sort_order: 3, metadata: { labour: true, hours: 2, rate: 680, rate_overridden: false } },
      { id: "x", area_id: "B", item_name: "Other", unit_price: 1 },
    ];
    const rows = duplicateAreaRows(items, "A");
    expect(rows.map((r) => r.srcId)).toEqual(["u", "k", "l"]);
    expect(rows[0].row).toMatchObject({ unit_price: 9738.26, metadata: { cost_excl: 7790.61, price_locked: true } });
    expect(rows[1].parentSrcId).toBe("u");
    expect(rows[1].row).toMatchObject({ is_bundle: true, unit_price: 364.1, length: 1 });
    expect(rows[2].row).toMatchObject({ unit_price: 680, quantity: 2, metadata: { labour: true, hours: 2, rate: 680 } });
    rows[0].row.metadata.cost_excl = 1;
    expect(items[0].metadata.cost_excl).toBe(7790.61); // deep copy
    expect((rows[0].row as any).id).toBeUndefined();
    expect((rows[0].row as any).area_id).toBeUndefined();
  });
});
