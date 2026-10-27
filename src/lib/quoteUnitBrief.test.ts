import { describe, it, expect } from "vitest";
import { quoteUnitBrief, quoteUnitBriefParts } from "./quoteUnitBrief";
const u = (item_name: string, quantity = 1, extra = {}) => ({ item_name, quantity, parent_item_id: null, ...extra });
describe("quoteUnitBrief", () => {
  it("brand, sizes, count", () => expect(quoteUnitBrief([u("Samsung 9k midwall"), u("Samsung 12k midwall", 2), u("Installation labour 12k", 3, { item_type: "labour" })])).toBe("Samsung · 3 units · 9k + 12k"));
  it("uses metadata and maps Comfy", () => expect(quoteUnitBrief([u("AC100NN4DEH/AF", 1, { metadata: { is_unit: true, brand: "samsung", capacity_btu: 34000 } }), u("Comfy 18000 BTU inverter")])).toBe("Samsung, Comfee · 2 units · 18k + 34k"));
  it("null without units", () => expect(quoteUnitBrief([u("Copper pipe 12k kit")])).toBeNull());
  it("two lines for the table", () => expect(quoteUnitBriefParts([u("Comfee 12k midwall"), u("Comfee 23k midwall"), u("Comfee 24k midwall")])).toEqual({ head: "Comfee · 3 units", sizes: "12k + 23k + 24k" }));
  it("singular unit", () => expect(quoteUnitBriefParts([u("LG 9k inverter")])).toEqual({ head: "LG · 1 unit", sizes: "9k" }));
});
