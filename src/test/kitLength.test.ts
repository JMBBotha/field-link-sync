import { describe, it, expect } from "vitest";
import { kitLengthPatch, kitRowFields } from "@/lib/mandy/quoteOps";
import { kitTitleFromMetadata, kitContents, qtyLabel } from "@/lib/lineDisplay";

const q14 = () => ({
  item_name: "12K INV 1/4&1/2 PIPING KIT COPPER LASSO ISO CABLE TIES ONLY", quantity: 1, length: 3, unit_price: 1103.26, total_price: 1103.26,
  metadata: {
    markup_percent: 100, unit_cost: 551.63, install: { role: "piping_kit", unit_item_id: "u1" },
    kit: { bundle_id: "b", pricing_type: "p/meter", unit_sell: 367.75, unit_cost: 183.87639615040976, items: [
      { name: "Soft Drawn Copper 1/4 Inch 15.24 mtr", quantity: 1, isLengthItem: true },
      { name: "Arma Flex 1/4 x 1/4 (1.8mtr)", quantity: 1, isLengthItem: true },
      { name: "Soft Drawn Copper 1/2 Inch 15.24 mtr", quantity: 1, isLengthItem: true },
      { name: "Arma Flex 1/2 x 1/4 (1.8mtr)", quantity: 1, isLengthItem: true },
      { name: "Lasso Tape 48mm x 30mtr", quantity: 0.3333, isLengthItem: true },
      { name: "Cable Ties T50I", quantity: 6, isLengthItem: false },
    ] },
  },
});

describe("kit length", () => {
  it("3 → 4.5 m", () => {
    const cur = q14();
    const p = kitLengthPatch(cur, 4.5);
    expect(p.length).toBe(4.5);
    expect((p as any).quantity).toBeUndefined();
    expect(p.unit_price).toBe(1654.88);
    expect(p.total_price).toBe(1654.88);
    expect(p.metadata.unit_cost).toBe(827.44);
    expect(p.metadata.markup_percent).toBe(100);
    expect(p.metadata.install).toEqual(cur.metadata.install);
    const items = p.metadata.kit.items;
    expect(items[5]).toMatchObject({ qty_per_m: 2, quantity: 9 });
    expect(items[4].quantity).toBeCloseTo(1.5, 2);
    expect(items[0]).toMatchObject({ qty_per_m: 1, quantity: 4.5 });
    expect(p.metadata.kit.length_m).toBe(4.5);
    // display
    const row = { ...cur, ...p };
    expect(kitTitleFromMetadata(row)).toBe("Piping kit 1/4 + 1/2 · 4.5 m");
    expect(qtyLabel(row)).toBe("4.5 m");
    const c = kitContents(row);
    expect(c[0].qty).toBe("4.5 m");
    expect(c[4].qty).toBe("1.5 m");
    expect(c[5].qty).toBe("9");
    // input not mutated
    expect(cur.metadata.kit.items[5].quantity).toBe(6);
  });
  it("round trip 4.5 → 3", () => {
    const cur = q14();
    const p1 = kitLengthPatch(cur, 4.5);
    const p2 = kitLengthPatch({ ...cur, ...p1 }, 3);
    expect(p2.unit_price).toBe(1103.25);
    expect(p2.metadata.kit.items[5].quantity).toBe(6);
  });
  it("clamps at 0.1 m", () => {
    expect(kitLengthPatch(q14(), 0.01).length).toBe(0.1);
  });
  it("legacy row without patch still shows 3 m contents", () => {
    const c = kitContents(q14());
    expect(c[5].qty).toBe("6");
    expect(c[0].qty).toBe("3 m");
  });
  it("new kits default to 3 m with qty_per_m", () => {
    const bundle: any = { id: "b", name: "Kit", items: [
      { quantity: 1, is_length_item: true, product: { id: "c", product_code: "COP", short_name: "Copper 1/4 Inch", price_per_metre: 10, cost_price: 5, sold_in_length: true } },
      { quantity: 2, is_length_item: false, product: { id: "t", product_code: "TIE", short_name: "Tie", cost_price: 0.1, selling_price: 0.2 } },
    ] };
    const r = kitRowFields(bundle);
    if (r.length != null) {
      expect(r.length).toBe(3);
      expect(r.fields.metadata.kit.length_m).toBe(3);
      const tie = r.fields.metadata.kit.items.find((i: any) => i.code === "TIE");
      expect(tie).toMatchObject({ qty_per_m: 2, quantity: 6 });
    }
  });
});
