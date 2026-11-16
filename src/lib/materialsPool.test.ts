import { describe, expect, it } from "vitest";
import { materialBuyError, poolLines, poolValue } from "./materialsPool";

describe("materials pool value", () => {
  it("sums the pool and leaves units and direct deliveries out", () => {
    const value = poolValue([
      { bucket: "material_pool", qty: 100, unitCost: 256 },
      { bucket: "material_pool", qty: -10, unitCost: 256 },
      { bucket: "job_unit", qty: 1, unitCost: 9000 },
      { bucket: "general_unit", qty: 2, unitCost: 1000 },
      { bucket: "material_pool", qty: 0, unitCost: 0, valueAdjust: 40, counts: true },
    ]);
    expect(value).toBe(23080);
    const lines = poolLines([
      { label: "Copper pipe", qty: 100, unitCost: 256, bucket: "material_pool" },
      { label: "Copper pipe", qty: -10, unitCost: 256, bucket: "material_pool" },
      { label: "Indoor", qty: 1, unitCost: 9000, bucket: "job_unit" },
    ]);
    expect(lines).toEqual([{ label: "Copper pipe", qty: 90, value: 23040 }]);
  });

  it("asks for the item, the quantity and the cost before a buy is saved", () => {
    expect(materialBuyError({ item: "", qty: "1", unit: "m", total: "10", date: "2026-11-03", supplier: "", docRef: "", used: "" })).toMatch(/item/i);
    expect(materialBuyError({ item: "Copper", qty: "5", unit: "m", total: "10", date: "2026-11-03", supplier: "", docRef: "", used: "9" })).toMatch(/Already used/);
    expect(materialBuyError({ item: "Copper", qty: "5", unit: "m", total: "10", date: "2026-11-03", supplier: "OSS", docRef: "1", used: "1" })).toBeNull();
  });
});
