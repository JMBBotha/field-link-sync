import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { labourLineTotal, labourMarkupPercent, stepHours, snapHours, planLabour, standardLabourRate, labourFields } from "@/lib/labour";
import { buildClientRollup } from "@/lib/clientQuoteRollup";
import { runSetLabourHours } from "@/lib/mandy/labourAction";

describe("hourly labour", () => {
  it("line total = hours × rate at 0% markup", () => {
    expect(labourMarkupPercent({ units: 25, materials: 100 })).toBe(0);
    expect(labourLineTotal(3, 450)).toBe(1350);
    const f = labourFields(2.5, 500, false);
    expect(f.total_price).toBe(1250);
    expect(f.metadata.total_cost).toBe(1250);
    expect(f.metadata.markup_percent).toBe(0);
  });
  it("steps in 0.5 and never below 0", () => {
    expect(stepHours(0, 1)).toBe(0.5);
    expect(stepHours(2, 1)).toBe(2.5);
    expect(stepHours(0.5, -1)).toBe(0);
    expect(stepHours(0, -1)).toBe(0);
    expect(snapHours(1.3)).toBe(1.5);
  });
  it("saved rate is not repriced when the standard rate changes", () => {
    const saved = { item_type: "labour", metadata: { labour: true, hours: 2, rate: 400, rate_overridden: false } };
    const p = planLabour(saved, 3, 600);
    expect(p.needsRate).toBe(false);
    if (!p.needsRate) { expect(p.fields.unit_price).toBe(400); expect(p.fields.total_price).toBe(1200); }
    const fresh = planLabour(undefined, 1, 600);
    if (!fresh.needsRate) expect(fresh.fields.unit_price).toBe(600);
  });
  it("unset standard rate means needs rate", () => {
    expect(standardLabourRate(null)).toBeNull();
    expect(standardLabourRate(0)).toBeNull();
    expect(planLabour(undefined, 2, null).needsRate).toBe(true);
    const typed = planLabour(undefined, 2, null, 350);
    if (!typed.needsRate) { expect(typed.fields.total_price).toBe(700); expect(typed.fields.metadata.rate_overridden).toBe(true); }
  });
  it("client PDF area total includes labour with no labour line shown", () => {
    const lab = labourFields(2, 500, false);
    const r = buildClientRollup(
      [
        { id: "u", area_id: "A", item_name: "Samsung 24K", category: "Air Conditioning", quantity: 1, unit_price: 17825.22, total_price: 17825.22 } as any,
        { id: "l", area_id: "A", ...lab } as any,
      ],
      [{ id: "A", name: "Main bedroom" }],
    );
    expect(r).toHaveLength(1);
    expect(r[0].areaTotal).toBeCloseTo(18825.22, 2);
    expect(r[0].units.map((u) => u.unitName)).toEqual(["Samsung 24K"]);
  });
});

describe("set_labour_hours", () => {
  const areas = [{ id: "A", name: "Main bedroom" }, { id: "B", name: "Lounge" }];
  it("creates the area's labour row at the standard rate", async () => {
    const addItem = vi.fn(async () => ({ id: "n" })), updateItem = vi.fn();
    const r = await runSetLabourHours({ areas, items: [], standardRate: 450, addItem, updateItem }, { area: "main bedroom", hours: 3 });
    expect(r.ok).toBe(true);
    expect(addItem).toHaveBeenCalledWith(expect.objectContaining({ area_id: "A", quantity: 3, unit_price: 450, total_price: 1350, item_type: "labour" }));
  });
  it("updates an existing row keeping its saved rate", async () => {
    const items = [{ id: "L", area_id: "B", item_type: "labour", metadata: { labour: true, hours: 1, rate: 400 } }];
    const updateItem = vi.fn();
    await runSetLabourHours({ areas, items, standardRate: 600, addItem: vi.fn(), updateItem }, { area: "Lounge", hours: 2, mode: "set" });
    expect(updateItem).toHaveBeenCalledWith("L", expect.objectContaining({ quantity: 2, unit_price: 400, total_price: 800 }));
  });
  it("unknown area returns area chips", async () => {
    const addItem = vi.fn();
    const r = await runSetLabourHours({ areas, items: [], standardRate: 450, addItem, updateItem: vi.fn() }, { area: "garage", hours: 2 });
    expect(r.choices?.map((c) => c.label)).toEqual(["Main bedroom", "Lounge"]);
    expect(addItem).not.toHaveBeenCalled();
  });
});
