import { describe, expect, it } from "vitest";
import { buildCalendarEntries } from "@/lib/todaysJobs";
import {
  bookedDiffersFromQuote, materialFact, materialsWritePlan, newRowDayCount, newVisitSeed, quoteLinesFromPackAndPlan, stockMatch,
  scheduleWritePlan, startingMaterialLines, visitLabel, type BookedMaterial, type MaterialLine,
} from "@/lib/completeJobBookings";

const booked = (over: Partial<BookedMaterial> & { id: string; item: string; qty: number }): BookedMaterial => ({ source: "used", ...over });
const line = (over: Partial<MaterialLine> & { key: string; item: string }): MaterialLine => ({ qty: 1, unit: null, kind: "material", ...over });

describe("complete job days", () => {
  it("labels a Johannesburg calendar day without shifting it", () => {
    expect(visitLabel("2026-11-03", "14:00", "17:00")).toBe("Tue 3 Nov 2026, 14:00–17:00");
  });

  it("seeds a new day instead of copying an existing row", () => {
    const seed = newVisitSeed([{ id: "a", date: "2026-11-03", start: "14:00", end: "17:00" }], "2026-11-03");
    expect(seed.date).not.toBe("2026-11-03");
    expect(seed.date <= "2026-11-03").toBe(true);
  });

  it("adds beside existing days and does not plan an update", () => {
    const plan = scheduleWritePlan(
      [{ id: "old", date: "2026-11-04", start: "12:00", end: "14:00" }],
      [{ date: "2026-11-02", start: "08:00", end: "16:00" }],
      "keep_add",
    );
    expect(plan.error).toBeNull();
    expect(plan.deleteIds).toEqual([]);
    expect(plan.insert).toEqual([{ date: "2026-11-02", start: "08:00", end: "16:00" }]);
    expect(newRowDayCount(1, 1)).toEqual({ dayIndex: [2], dayCount: 2 });
  });

  it("refuses to add onto a day that is already booked", () => {
    const plan = scheduleWritePlan(
      [{ id: "old", date: "2026-11-02", start: "08:00", end: "11:00" }],
      [{ date: "2026-11-02", start: "13:00", end: "16:00" }],
      "keep_add",
    );
    expect(plan.error).toMatch(/already booked/);
    expect(plan.insert).toEqual([]);
  });

  it("override deletes this job's rows and inserts the new days, and does nothing in place", () => {
    const plan = scheduleWritePlan(
      [{ id: "old-1", date: "2026-11-04", start: "12:00", end: "14:00" }, { id: "old-2", date: "2026-11-05", start: "08:00", end: "10:00" }],
      [{ date: "2026-11-01", start: "08:00", end: "12:00" }, { date: "2026-11-02", start: "08:00", end: "16:00" }],
      "override",
    );
    expect(plan.deleteIds).toEqual(["old-1", "old-2"]);
    expect(plan.insert).toHaveLength(2);
    expect(newRowDayCount(0, 2).dayCount).toBe(2);
  });

  it("does not pick a mode when days are already booked", () => {
    expect(scheduleWritePlan([{ id: "old", date: "2026-11-02", start: "08:00", end: "09:00" }], [{ date: "2026-11-01", start: "08:00", end: "09:00" }], null).error).toMatch(/add these days or replace/);
    expect(scheduleWritePlan([], [{ date: "2026-11-01", start: "08:00", end: "09:00" }], null).insert).toHaveLength(1);
  });

  it("shows an added day and a replaced run on the calendar, and drops the old slot after override", () => {
    const added = buildCalendarEntries([
      { id: "old", lead_id: "l", job_id: "j", agent_id: "t", scheduled_date: "2026-11-04", start_time: "12:00", day_count: null, jobs: { status: "completed" }, leads: { status: "converted" } },
      { id: "new", lead_id: "l", job_id: "j", agent_id: "t", scheduled_date: "2026-11-02", start_time: "08:00", day_index: 2, day_count: 2, jobs: { status: "completed" }, leads: { status: "converted" } },
    ], []);
    expect(added.map((e) => e.date).sort()).toEqual(["2026-11-02", "2026-11-04"]);

    // The lead's own date is moved onto the new first day, so the old lead tile does not come back.
    const replaced = buildCalendarEntries([
      { id: "a", lead_id: "l", job_id: "j", agent_id: "t", scheduled_date: "2026-11-01", start_time: "08:00", day_index: 1, day_count: 2, jobs: { status: "completed" } },
      { id: "b", lead_id: "l", job_id: "j", agent_id: "t", scheduled_date: "2026-11-02", start_time: "08:00", day_index: 2, day_count: 2, jobs: { status: "completed" } },
    ], [{ id: "l", assigned_agent_id: "t", scheduled_date: "2026-11-02", scheduled_time: "08:00", status: "converted" }]);
    expect(replaced.map((e) => e.date).sort()).toEqual(["2026-11-01", "2026-11-02"]);
    expect(replaced.every((e) => e.status === "completed")).toBe(true);
  });
});

describe("complete job materials", () => {
  const quote = [
    line({ key: "u", item: "Indoor cassette", code: "FTXM35", kind: "unit", qty: 1 }),
    line({ key: "cu", item: "Copper pipe", qty: 15, unit: "m", stockItemId: "s-cu", quoteItemId: "qi-cu" }),
  ];

  it("starts an install from the quote units and materials", () => {
    const pack = quoteLinesFromPackAndPlan(
      [{ item_name: "Indoor cassette", item_code: "FTXM35", quantity: 1 }, { item_name: "Copper pipe", item_code: "CU", quantity: 15 }],
      { items: [{ quote_item_id: "qi-cu", product_id: "p-cu", item_name: "Copper pipe", quantity: 15, product: { product_code: "CU", product_type: "material" } }], stock: [{ id: "s-cu", product_id: "p-cu", stock_unit: "m" }] },
    );
    expect(pack.map((l) => l.item)).toEqual(["Indoor cassette", "Copper pipe"]);
    expect(pack[1]).toMatchObject({ stockItemId: "s-cu", quoteItemId: "qi-cu", unit: "m" });
    expect(startingMaterialLines("installation", pack, []).lines.map((l) => l.item)).toEqual(["Indoor cassette", "Copper pipe"]);
  });

  it("does not invent repair gas when the quote has no extra parts", () => {
    const start = startingMaterialLines("service", quote, []);
    expect(start.lines).toEqual([]);
    expect(start.note).toMatch(/R410 or R32/);
    expect(JSON.stringify(start)).not.toMatch(/R410A bottle|R32 bottle/);
  });

  it("shows a repair part that is on the job and leaves the gas note", () => {
    const start = startingMaterialLines("service", [], [booked({ id: "p", item: "Capacitor", qty: 1 })]);
    expect(start.lines.map((l) => l.item)).toEqual(["Capacitor"]);
    expect(start.note).toMatch(/R410 or R32/);
  });

  it("describes what is already booked", () => {
    expect(materialFact(booked({ id: "m", item: "Copper pipe", qty: 6, unit: "m", drawnQty: 6, stockItemId: "s-cu" }))).toBe("Copper pipe · 6 m · drawn 6 m");
    expect(bookedDiffersFromQuote(quote, [booked({ id: "m", item: "Copper pipe", qty: 6, stockItemId: "s-cu", quoteItemId: "qi-cu" })])).toBe(true);
  });

  it("add draws only new lines and override replaces, without editing a booked row", () => {
    const existing = [booked({ id: "m", item: "Copper pipe", qty: 6, drawnQty: 6, stockItemId: "s-cu", quoteItemId: "qi-cu" })];
    const editor = [line({ key: "cu", item: "Copper pipe", qty: 15, stockItemId: "s-cu", quoteItemId: "qi-cu" }), line({ key: "br", item: "Wall brackets", qty: 1, stockItemId: "s-br" })];
    const add = materialsWritePlan(editor, existing, "keep_add");
    expect(add.reverseDraws).toBe(false);
    expect(add.insert.map((l) => l.item)).toEqual(["Wall brackets"]);
    const over = materialsWritePlan(editor, existing, "override");
    expect(over.reverseDraws).toBe(true);
    expect(over.releaseReservations).toBe(true);
    expect(over.insert.map((l) => l.item)).toEqual(["Copper pipe", "Wall brackets"]);
    expect(materialsWritePlan(editor, existing, null).error).toMatch(/add these materials or replace/);
    expect(stockMatch("Wall brackets", [{ id: "s-br", item: "Wall brackets", stock_unit: "each" }])?.id).toBe("s-br");
    expect(stockMatch("gas", [{ id: "s", item: "R410" }])).toBeNull();
  });
});
