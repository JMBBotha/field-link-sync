import { describe, it, expect } from "vitest";
import { remapInstallUnitIds, basketInstallFrom, installTag } from "@/lib/installTemplates";
import { basketsToQuoteState } from "@/utils/quoteBasketTotals";
import { installBasketItem } from "@/lib/mandy/quoteOps";
import { unitsWithInstall, installLinesOf } from "@/lib/mandy/installEdits";

const prod = (id: string, extra: any = {}) => ({ id, product_code: id, short_name: id, product_category: "Consumables", cost_price: 132.25, cost_excl_vat: 132.25, default_markup_percent: 100, ...extra }) as any;

describe("builder save keeps install links", () => {
  it("basket → save rows → new ids → tags point at the unit's NEW id", () => {
    const unitKey = "unit-old";
    const baskets: any[] = [{ id: "area-1", name: "General", items: [
      { instanceId: unitKey, product: prod("AR40F12C0AG/FA", { product_category: "Air Conditioning", cost_price: 7790.61 }), quantity: 1 },
      installBasketItem({ role: "trunking_main", product: prod("TRUNK01", { sold_in_length: true, unit_length: 3, price_per_metre: 44.08 }), qty: 1 }, unitKey, "tpl-12"),
      { instanceId: "x", product: prod("OTHER"), quantity: 1 },
    ] }];
    const { items } = basketsToQuoteState(baskets);
    expect(installTag(items[1])).toEqual({ unit_item_id: unitKey, role: "trunking_main", template_id: "tpl-12" });
    expect((items[1].metadata as any).supplier_length_m).toBe(3);
    expect(items[1].unit_price).toBeCloseTo(264.5, 2); // locked whole-length price

    const idMap = new Map(items.map((it, i) => [it.id, `new-${i}`]));
    const saved = remapInstallUnitIds(items.map((it) => ({ ...it, id: idMap.get(it.id)! })), idMap);
    expect(installTag(saved[1])!.unit_item_id).toBe("new-0");
    expect(installTag(saved[2])).toBeNull();
    // Mandy's lookup still finds the unit and its line after the rewrite.
    expect(unitsWithInstall(saved as any).map((u) => u.id)).toEqual(["new-0"]);
    expect(installLinesOf(saved as any, "new-0").map((l) => l.id)).toEqual(["new-1"]);
  });

  it("orphaned tag (unit not in this save) is dropped, other metadata kept", () => {
    const rows = [{ id: "a", metadata: { install: { unit_item_id: "gone", role: "bracket", template_id: null }, unit_cost: 5 } }];
    const out = remapInstallUnitIds(rows, new Map());
    expect(out[0].metadata.install).toBeUndefined();
    expect(out[0].metadata.unit_cost).toBe(5);
  });

  it("hydration reads the tag back into the basket link", () => {
    expect(basketInstallFrom({ metadata: { install: { unit_item_id: "u", role: "drain_pipe", template_id: "t" }, supplier_length_m: 4 } }))
      .toEqual({ unitKey: "u", role: "drain_pipe", template_id: "t", supplier_length_m: 4 });
  });
});
