import { describe, expect, it, vi } from "vitest";
import { applyAutoLabourDelta, areaLabourStatus, countAcUnits, defaultLabourHours } from "@/lib/areaLabour";

const unit = (quantity: number) => ({ item_name: "Samsung 12000 BTU inverter", item_type: "product", quantity, metadata: {} });

describe("per-area labour", () => {
  it("counts AC quantity, not rows", () => expect(countAcUnits([unit(2), unit(1)])).toBe(3));
  it("calculates configured defaults", () => {
    expect(defaultLabourHours(1, 3.5)).toBe(3.5);
    expect(defaultLabourHours(2, 3.5)).toBe(7);
    expect(defaultLabourHours(1, 3.5) * 680).toBe(2380);
    expect(defaultLabourHours(2, 3.5) * 680).toBe(4760);
  });
  it("exempts empty areas and flags populated areas without positive labour", () => {
    expect(areaLabourStatus([]).missing).toBe(false);
    expect(areaLabourStatus([{ item_name: "Service", quantity: 1 }]).missing).toBe(true);
    expect(areaLabourStatus([{ item_name: "Service", quantity: 1 }, { item_name: "Labour", item_type: "labour", quantity: 0, metadata: { labour: true } }]).missing).toBe(true);
  });
  it("reports automatic labour and its default", () => expect(areaLabourStatus([unit(2), { item_name: "Labour", item_type: "labour", quantity: 7, metadata: { labour: true, labour_auto: true, hours: 7 } }])).toMatchObject({ hours: 7, defaultHours: 7, isAuto: true }));
  it("creates auto labour and never changes manual labour", async () => {
    const addItem = vi.fn(async (x) => x), updateItem = vi.fn();
    await applyAutoLabourDelta({ items: [], areaId: "A", unitDelta: 2, perUnit: 3.5, rate: 680, addItem, updateItem });
    expect(addItem).toHaveBeenCalledWith(expect.objectContaining({ area_id: "A", quantity: 7, unit_price: 680, total_price: 4760, metadata: expect.objectContaining({ labour_auto: true }) }));
    const manual = { id: "L", area_id: "A", item_type: "labour", quantity: 2, metadata: { labour: true, labour_auto: false } };
    await applyAutoLabourDelta({ items: [manual], areaId: "A", unitDelta: 1, perUnit: 3.5, rate: 680, addItem, updateItem });
    expect(updateItem).not.toHaveBeenCalled();
  });
  it("does not create a labour row while removing a unit from legacy data", async () => {
    const addItem = vi.fn(async (x) => x), updateItem = vi.fn();
    await applyAutoLabourDelta({ items: [], areaId: "A", unitDelta: -1, perUnit: 3.5, rate: 680, addItem, updateItem });
    expect(addItem).not.toHaveBeenCalled();
  });
});