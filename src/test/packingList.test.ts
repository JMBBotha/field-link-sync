import { describe, it, expect, beforeEach } from "vitest";
import { fmtQty, groupPackingList, loadTicks, saveTicks } from "@/lib/packingList";

const row = (area: string | null, name: string, code: string | null, kit: string | null = null, q: any = 1) =>
  ({ area_name: area, area_sort: 0, kit_name: kit, item_code: code, item_name: name, quantity: q, line_sort: 0 });

describe("tech packing list", () => {
  beforeEach(() => localStorage.clear());
  it("groups by area in server order, kit parts keep their kit, keys are unique", () => {
    const g = groupPackingList([row("Lounge", "Midea 24K", "INV24"), row("Lounge", "Copper 5/8", "COPRL004", "24K kit", 3),
      row("Lounge", "Copper 5/8", "COPRL004", "24K kit", 3), row(null, "Bracket", "BRAC05")]);
    expect(g.map((x) => x.area)).toEqual(["Lounge", "General"]);
    const keys = g.flatMap((x) => x.rows.map((r) => r.key));
    expect(new Set(keys).size).toBe(keys.length);
    expect(g[0].rows[1].kit_name).toBe("24K kit");
  });
  it("ticks are saved per job on this device", () => {
    saveTicks("job-1", { a: true });
    expect(loadTicks("job-1")).toEqual({ a: true });
    expect(loadTicks("job-2")).toEqual({});
  });
  it("quantities print without prices or long decimals", () => {
    expect(fmtQty("3")).toBe("3");
    expect(fmtQty(0.3333333)).toBe("0.33");
    expect(fmtQty(null)).toBe("0");
  });
});
