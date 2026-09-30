import { describe, it, expect, vi } from "vitest";
import { applyAutoLabourDelta, isJobLabour, jobModeLabourLines, planLabourInsert, unassignedLabourLines } from "@/lib/areaLabour";
import { buildClientRollup } from "@/lib/clientQuoteRollup";

// Q-2026-0014: the job row got an area (orphan move) and vanished from the screen while it stayed in the totals.
const A = "area-lounge";
const lab = (id: string, area_id: string | null, hours: number, scope?: string, auto = false) => ({
  id, area_id, parent_item_id: null, item_type: "labour", item_name: scope ? "Job labour" : "Labour", quantity: hours, unit_price: 680, total_price: hours * 680,
  metadata: { labour: true, hours, rate: 680, labour_auto: auto, ...(scope ? { labour_scope: scope } : {}) },
});
const unit = { id: "u1", area_id: A, parent_item_id: null, item_type: "product", item_name: "Midea 24K INV MW", quantity: 1, unit_price: 17434.21, total_price: null, metadata: {} };
const b = lab("b", A, 5.5, "job");
const areas = [{ id: A, name: "Main Lounge Area" }];

describe("hidden labour (Q-2026-0014)", () => {
  it("a job-scope row with an area is still the job row", () => expect(isJobLabour(b)).toBe(true));

  it("every labour line is shown somewhere in both modes", () => {
    const lines = [unit, b, lab("j", null, 3.5, "job", true), lab("area", A, 2), lab("stale", "gone-area", 1), lab("none", null, 1)];
    const labour = lines.filter((l) => l.item_type === "labour").map((l) => l.id).sort();
    const job = [...jobModeLabourLines(lines, areas), ...unassignedLabourLines(lines, areas, "job")].map((l) => l.id).sort();
    expect(job).toEqual(labour);
    const perArea = [...lines.filter((l) => l.item_type === "labour" && l.area_id === A), ...unassignedLabourLines(lines, areas, "per_area")].map((l) => l.id).sort();
    expect(perArea).toEqual(labour);
  });

  it("job mode: a labour insert merges into the one job line", () => {
    const p = planLabourInsert("job", [unit, b] as any, lab("new", A, 2));
    expect(p.kind).toBe("merge");
    if (p.kind !== "merge") return;
    expect(p.id).toBe("b");
    expect(p.patch).toMatchObject({ area_id: null, quantity: 7.5, unit_price: 680, total_price: 5100, metadata: { labour_scope: "job", hours: 7.5 } });
  });

  it("job mode without a job line: the insert becomes the job line; per_area and products pass through", () => {
    const first = planLabourInsert("job", [unit] as any, lab("new", A, 3.5));
    expect(first).toMatchObject({ kind: "insert", row: { area_id: null, item_name: "Job labour", metadata: { labour_scope: "job" } } });
    const row = lab("x", A, 2);
    expect(planLabourInsert("per_area", [b] as any, row)).toEqual({ kind: "insert", row });
    expect(planLabourInsert("job", [b] as any, unit)).toEqual({ kind: "insert", row: unit });
  });

  it("adding a unit in job mode does not create a second job line next to (b)", async () => {
    const addItem = vi.fn(async (x) => x), updateItem = vi.fn();
    await applyAutoLabourDelta({ items: [unit, b], areaId: null, job: true, unitDelta: 1, perUnit: 3.5, rate: 680, addItem, updateItem });
    expect(addItem).not.toHaveBeenCalled();
    const auto = lab("a", A, 3.5, "job", true);
    await applyAutoLabourDelta({ items: [unit, auto], areaId: null, job: true, unitDelta: 1, perUnit: 3.5, rate: 680, addItem, updateItem });
    expect(addItem).not.toHaveBeenCalled();
    expect(updateItem).toHaveBeenCalledWith("a", expect.objectContaining({ area_id: null, quantity: 7 }));
  });

  it("client PDF: job-scope labour goes to the Job labour block even with an area", () => {
    const r = buildClientRollup([unit, b] as any, [{ id: A, name: "Main Lounge Area", sort_order: 0 }] as any);
    expect(r.find((x) => x.isJobLabour)?.areaTotal).toBe(3740);
    expect(r.find((x) => x.areaId === A)?.areaTotal).toBe(17434.21);
  });
});
