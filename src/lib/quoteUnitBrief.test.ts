import { describe, it, expect } from "vitest";
import { quoteUnitBrief } from "./quoteUnitBrief";
const u = (item_name: string, quantity = 1, extra = {}) => ({ item_name, quantity, parent_item_id: null, ...extra });
describe("quoteUnitBrief", () => {
  it("brand, sizes, count", () => expect(quoteUnitBrief([u("Samsung 9k midwall"), u("Samsung 12k midwall", 2), u("Installation labour 12k", 3, { item_type: "labour" })])).toBe("Samsung · 9k + 12k · 3 units"));
  it("uses metadata and maps Comfy", () => expect(quoteUnitBrief([u("AC100NN4DEH/AF", 1, { metadata: { is_unit: true, brand: "samsung", capacity_btu: 34000 } }), u("Comfy 18000 BTU inverter")])).toBe("Samsung, Comfee · 18k + 34k · 2 units"));
  it("null without units", () => expect(quoteUnitBrief([u("Copper pipe 12k kit")])).toBeNull());
});
