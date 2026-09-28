import { describe, it, expect } from "vitest";
import { isAcUnitLine } from "@/lib/lineDisplay";
import { groupEstimateInstallLines } from "@/components/quoting/EstimateDocument";

const L = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, description: null, quantity: 1, unit_price: 10, ...extra }) as any;

describe("isAcUnitLine", () => {
  it("product-picker unit groups the copper under it, not the area", () => {
    const isUnit = isAcUnitLine({ item_name: "Samsung 24K INV MW", item_type: "product" }, { product_category: "Air Conditioning" });
    expect(isUnit).toBe(true);
    const copper = { item_name: "Soft Drawn Copper 3/8", item_type: "product" };
    expect(isAcUnitLine(copper, { product_category: "Consumables" })).toBe(false);
    const rows = groupEstimateInstallLines([L("u", { isAcUnit: isUnit }), L("c", { name: copper.item_name })], "a");
    expect(rows[1]).toMatchObject({ kind: "install-summary", unitId: "u" });
  });
  it("name-only unit", () => {
    expect(isAcUnitLine({ item_name: "LG 12K Inverter Split", item_type: "product" })).toBe(true);
  });
  it("kit name is not a unit and groups as material", () => {
    const n = "12K INV 1/4&1/2 PIPING KIT";
    expect(isAcUnitLine({ item_name: n, item_type: "product" })).toBe(false);
    const rows = groupEstimateInstallLines([L("u", { isAcUnit: true }), L("k", { name: n })]);
    expect((rows[1] as any).lines.map((l: any) => l.id)).toEqual(["k"]);
  });
  it("labour, service and consumables are never units", () => {
    expect(isAcUnitLine({ item_name: "Samsung 24K install labour", metadata: { labour: true } })).toBe(false);
    expect(isAcUnitLine({ item_name: "Service 24K split", item_type: "service" })).toBe(false);
    expect(isAcUnitLine({ item_name: "Samsung 24K INV", metadata: { catalog_service_id: "x" } })).toBe(false);
    expect(isAcUnitLine({ item_name: "24K INV kit", item_type: "Consumables" })).toBe(false);
  });
});
