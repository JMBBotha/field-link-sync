import { describe, it, expect } from "vitest";
import { stockUnitFor, toStockQty, costPerStockUnit, quoteDrawQty } from "@/lib/stockUnits";

const u = (name: string, extra: any = {}) => stockUnitFor({ name, price_per_unit_label: "each", ...extra });

describe("stockUnitFor", () => {
  it("gas is stocked per kg with the cylinder as pack", () => {
    expect(u("R410a - 11.3kg Cylinder")).toMatchObject({ stock_unit: "kg", pack_size: 11.3, pack_label: "cylinder", sure: true });
    expect(u("R32 GAS 9,5KG")).toMatchObject({ stock_unit: "kg", pack_size: 9.5 });
    expect(u("R134a - 800g Can (Bulk Pricing Available)")).toMatchObject({ stock_unit: "kg", pack_size: 0.8, pack_label: "can" });
    expect(u("R410a - 800g Can with Red Valve")).toMatchObject({ stock_unit: "kg", pack_size: 0.8 });
  });
  it("gas-adjacent parts are not gas", () => {
    expect(u("Pencil Dryer - 15g").stock_unit).toBe("each");
    expect(u("Compressor - 1/4 (134a) (Free 15g Pencil Dryer & Access Valve)").stock_unit).toBe("each");
    expect(u("Manifold Set - R410, R134a, R22 & R404").kind).toBe("tool");
  });
  it("coils, rolls and lengths are stocked per metre", () => {
    expect(u("Copper - 1/4 (15m) Soft Drawn")).toMatchObject({ stock_unit: "m", pack_size: 15, pack_label: "coil" });
    expect(u("Aluminium - 3/8 (25m) (3003)")).toMatchObject({ stock_unit: "m", pack_size: 25, pack_label: "coil" });
    expect(u("Cabtyre - Cable white 3 core 50m")).toMatchObject({ stock_unit: "m", pack_size: 50, pack_label: "roll" });
    expect(u("Trunking - 16mmx16mmx3m")).toMatchObject({ stock_unit: "m", pack_size: 3 });
    expect(u("Conduit - 20mm X 3m")).toMatchObject({ stock_unit: "m", pack_size: 3 });
    expect(stockUnitFor({ name: "Soft Drawn Copper 1/4 Inch 15.24 mtr", price_per_unit_label: "m", sold_in_length: true, unit_length: 15.24 })).toMatchObject({ stock_unit: "m", pack_size: 15.24 });
    expect(u("Insulation - 1/2 X 1/4")).toMatchObject({ stock_unit: "m", sure: false });
  });
  it("fittings stay each, packs convert, liquids per litre", () => {
    expect(u("Copper Nut - 1/4").stock_unit).toBe("each");
    expect(u("Conduit - Elbow 20mm").stock_unit).toBe("each");
    expect(u("Cable Ties - T50R 198x4.7mm /100 Black")).toMatchObject({ stock_unit: "each", pack_size: 100 });
    expect(u("Acid Condenser Cleaner - 5L Coil Cleaner")).toMatchObject({ stock_unit: "l", pack_size: 5 });
    expect(u("PVC Weld 200ml")).toMatchObject({ stock_unit: "l", pack_size: 0.2 });
    expect(u("Tape - Lasso tape 50mm x 30m").stock_unit).toBe("roll");
    expect(u("Wired Controller - Wired remote controller + 3m cable").stock_unit).toBe("each");
    expect(stockUnitFor({ product_code: "STD-B2B-INST-09-12K", name: "All-in standard back-to-back installation" }).kind).toBe("labour");
  });
});

describe("conversions", () => {
  const coil = { pack_size: 15 };
  it("packs to stock units and cost per unit", () => {
    expect(toStockQty(2, coil)).toBe(30);
    expect(toStockQty(7.5, coil, "stock")).toBe(7.5);
    expect(costPerStockUnit(1500, coil)).toBe(100);
    expect(costPerStockUnit(1130, { pack_size: 11.3 })).toBe(100);
  });
  it("quote qty: per-metre catalogue rows are metres, pack rows are packs", () => {
    const trunk = { name: "PVC Trunking 16 x 16 x 3mtr", price_per_unit_label: "m", sold_in_length: true, unit_length: 3 };
    expect(quoteDrawQty(4.5, trunk)).toBe(4.5);
    expect(quoteDrawQty(1, { name: "R410a - 11.3kg Cylinder", price_per_unit_label: "each" })).toBe(0);
    expect(quoteDrawQty(3, { name: "Copper Nut - 1/4", price_per_unit_label: "each" })).toBe(3);
  });
});
