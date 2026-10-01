import { describe, it, expect } from "vitest";
import { classifyQuoteCategory as cq } from "@/lib/pricing";
import { standardSell } from "@/lib/priceGuard";
import { stubProductFromQuoteItem } from "@/utils/hydrateQuoteItem";
import { applyCategoryRatesToBaskets } from "@/utils/quoteBasketTotals";
import { isAcUnitLine } from "@/lib/lineDisplay";

const AC = "Air Conditioning";
describe("quote markup tidy", () => {
  it("category first, name as fallback", () => {
    for (const n of ["Samsung 12K INV MW", "Samsung 10kW MSP Duct", "Daikin Wired Remote Controller"]) expect(cq({ short_name: n, product_category: AC })).toBe("units");
    expect(cq({ short_name: "Heat compound", product_category: "Consumables" })).toBe("materials");
    expect(cq({ short_name: "Copper pipe", item_type: "product" })).toBe("materials");
    expect(cq({ short_name: "Copper pipe", metadata: { quote_category: "units" } })).toBe("units");
    expect(standardSell(14399.304, 25)).toBeCloseTo(17999.13, 2);
  });
  it("stamp survives hydrate; a manual line keeps its price on a Units % change", () => {
    const p = stubProductFromQuoteItem({ id: "x", item_name: "Copper pipe", unit_price: 500, quantity: 1, metadata: { unit_cost: 400, quote_category: "units", manual_price: true } });
    expect(cq(p as any)).toBe("units");
    const b: any = [{ id: "b", name: "Z", items: [{ instanceId: "i", quantity: 1, product: p }] }];
    expect(applyCategoryRatesToBaskets(b, { units: 40, materials: 100 })[0].items[0].product.locked_sell_ex_vat).toBe(500);
  });
  it("controllers are not AC units for labour", () => {
    expect(isAcUnitLine({ item_name: "KJR-120K", item_type: AC } as any, { category: "Controller" })).toBe(false);
    expect(isAcUnitLine({ item_name: "Samsung 12K INV MW", item_type: AC } as any)).toBe(true);
  });
});
