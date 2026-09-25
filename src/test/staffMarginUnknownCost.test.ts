import { describe, it, expect } from "vitest";
import { computeStaffMargin } from "@/components/quoting/StaffMarginCard";
import { runSetLabourHours } from "@/lib/mandy/labourAction";
import { labourModeFromText } from "@/lib/mandy/router";
import { vi } from "vitest";

describe("staff margin — cost unknown lines", () => {
  it("excludes no-cost lines from cost/profit/markup and counts them", () => {
    const items: any[] = [
      { id: "u", quantity: 1, unit_price: 9738.26, metadata: { unit_cost: 7790.61 } },
      { id: "x", quantity: 2, unit_price: 500, metadata: {} },
    ];
    const m = computeStaffMargin(items);
    expect(m.unknownCount).toBe(1);
    expect(m.unknownSell).toBe(1000);
    expect(m.cost).toBeCloseTo(7790.61, 2);
    expect(m.profit).toBeCloseTo(1947.65, 2);
    expect(m.markupPercent).toBeCloseTo(25, 1);
    expect(m.sell).toBeCloseTo(10738.26, 2);
  });
});

describe("set_labour_hours modes", () => {
  const areas = [{ id: "G", name: "General" }];
  const items = [{ id: "L", area_id: "G", item_type: "labour", description: "General labour", quantity: 2, metadata: { labour: true, hours: 2, rate: 680 } }];
  it("add increments", async () => {
    const updateItem = vi.fn();
    const r = await runSetLabourHours({ areas, items, standardRate: 680, addItem: vi.fn(), updateItem }, { area: "General", hours: 1, mode: "add" });
    expect(updateItem).toHaveBeenCalledWith("L", expect.objectContaining({ quantity: 3, total_price: 2040 }));
    expect(r.message).toContain("2 h → 3 h");
  });
  it("set replaces", async () => {
    const updateItem = vi.fn();
    const r = await runSetLabourHours({ areas, items, standardRate: 680, addItem: vi.fn(), updateItem }, { area: "General", hours: 1, mode: "set" });
    expect(updateItem).toHaveBeenCalledWith("L", expect.objectContaining({ quantity: 1, total_price: 680 }));
    expect(r.message).toContain("2 h → 1 h");
  });
  it("mode from verb", () => {
    expect(labourModeFromText("add 1 hour labour to general")).toBe("add");
    expect(labourModeFromText("make it 3 hours")).toBe("set");
    expect(labourModeFromText("set labour to 4 hours")).toBe("set");
  });
});
