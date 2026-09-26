import { describe, it, expect } from "vitest";
import { pipePairFromText, pickKitForUnit, importPipeFields } from "@/lib/kitSizes";
import { planStandardInstall, findPipingKitForBtu } from "@/lib/mandy/quoteOps";
import { extractBtu } from "@/lib/bundles";

const cu = (s: string) => ({ product: { id: `cu${s}`, short_name: `COPPER ${s}"`, description: "copper pipe" } });
const kit = (id: string, name: string, a: string, b: string, min: number | null, max: number | null) =>
  ({ id, name, description: "PIPING KIT", min_btu: min, max_btu: max, items: [cu(a), cu(b)] });
const K09 = kit("k09", "09K PIPING KIT", "1/4", "3/8", 8000, 10000);
const K12 = kit("k12", "12K PIPING KIT", "1/4", "1/2", 11000, 13000);
const K2412 = kit("k2412", "24K INV 3/8&1/2 PIPING KIT", "3/8", "1/2", 22000, 26000);
const K2458 = kit("k2458", "24K INV 3/8&5/8 PIPING KIT", "3/8", "5/8", null, null);
const KITS = [K09, K12, K2412, K2458];
const unit = (o: any) => ({ product_category: "Air Conditioning", ...o });
const btuOf = (u: any) => extractBtu(u);

describe("pipePairFromText", () => {
  it.each([
    ['1/4" x 3/8"', ["1/4", "3/8"]], ["3/8 5/8", ["3/8", "5/8"]], ["1/4 & 1/2", ["1/4", "1/2"]],
    ["6.35/12.7mm", ["1/4", "1/2"]], ["5/8 x 1/4", ["1/4", "5/8"]],
  ])("%s", (t, [l, g]) => expect(pipePairFromText(t)).toEqual({ liquid: l, gas: g }));
  it.each(["5/8 x 1 1/8", "5/8 1&1/8", "1/4 x 1/4", "1/2 Inch", "Refer to indoor unit for pipe sizes", "1/2 x 1", null])("null: %s", (t) =>
    expect(pipePairFromText(t as any)).toBeNull());
});

describe("importPipeFields", () => {
  it("keeps manual values (writes nothing)", () => {
    expect(importPipeFields({ pipe_sizes_manual: true, pipe_liquid: "1/4", pipe_gas: "1/2" }, '1/4" x 5/8"')).toEqual({});
  });
  it("parses for non-manual; never nulls on unparsable", () => {
    expect(importPipeFields({ pipe_sizes_manual: false }, "3/8 x 5/8")).toEqual({ pipe_size: "3/8 x 5/8", pipe_liquid: "3/8", pipe_gas: "5/8" });
    expect(importPipeFields(null, "")).toEqual({});
  });
});

describe("pickKitForUnit", () => {
  it("same-size kits: 18K unit → 18K kit, 12K unit → 12K kit", () => {
    const K18 = kit("k18", "18K PIPING KIT", "1/4", "1/2", 17000, 19000);
    const kits = [K09, K12, K18, K2412, K2458];
    const u18 = unit({ brand: "Samsung", product_code: "AR40F18C0AG/FA", btu_rating: 18000, pipe_liquid: "1/4", pipe_gas: "1/2" });
    expect(pickKitForUnit(kits, u18, { btuOf }).kit?.id).toBe("k18");
    const u12 = unit({ brand: "Samsung", product_code: "AR40F12C0AG/FA", btu_rating: 12000, pipe_liquid: "1/4", pipe_gas: "1/2" });
    expect(pickKitForUnit(kits, u12, { btuOf }).kit?.id).toBe("k12");
  });
  it("AR40F24C0AG (1/4+1/2) → 1/4+1/2 kit, not 3/8+1/2", () => {
    const u = unit({ brand: "Samsung", product_code: "AR40F24C0AG/FA", btu_rating: 24000, pipe_liquid: "1/4", pipe_gas: "1/2" });
    const r = pickKitForUnit(KITS, u);
    expect(r.kit?.id).toBe("k12");
    expect(r.reason).toBe("pipe");
    expect(planStandardInstall(u as any, [], KITS as any, []).kitBundle?.id).toBe("k12");
  });
  it("Midea 24K 3/8+5/8 → 3/8+5/8 kit", () => {
    const u = unit({ brand: "Midea", btu_rating: 24000, pipe_liquid: "3/8", pipe_gas: "5/8" });
    expect(pickKitForUnit(KITS, u).kit?.id).toBe("k2458");
  });
  it("no sizes → brand+BTU majority", () => {
    const u = unit({ brand: "LG", btu_rating: 12000 });
    const all = [
      unit({ brand: "LG", btu_rating: 12000, pipe_liquid: "1/4", pipe_gas: "3/8" }),
      unit({ brand: "LG", btu_rating: 12000, pipe_liquid: "1/4", pipe_gas: "3/8" }),
      unit({ brand: "LG", btu_rating: 12000, pipe_liquid: "1/4", pipe_gas: "1/2" }),
      unit({ brand: "Daikin", btu_rating: 12000, pipe_liquid: "1/4", pipe_gas: "1/2" }),
    ];
    const r = pickKitForUnit(KITS, u, { allUnits: all, btuOf });
    expect(r).toMatchObject({ reason: "brand_btu" });
    expect(r.kit?.id).toBe("k09");
  });
  it("1/4+5/8 with no exact kit → closest (same liquid first) with note", () => {
    const r = pickKitForUnit(KITS, unit({ brand: "X", pipe_liquid: "1/4", pipe_gas: "5/8" }));
    expect(r.reason).toBe("closest");
    expect(r.kit?.id).toBe("k12");
    expect(r.note).toBe("Closest kit (unit is 1/4+5/8) – tap to swap");
  });
  it("no sizes, no peers → BTU rule unchanged", () => {
    const u = unit({ brand: "Midea", btu_rating: 24000 });
    const r = pickKitForUnit(KITS, u, { allUnits: [], btuOf, btuFallback: () => findPipingKitForBtu(KITS as any, 24000) as any });
    expect(r.reason).toBe("btu");
    expect(r.kit?.id).toBe(findPipingKitForBtu(KITS as any, 24000)?.id);
  });
});
