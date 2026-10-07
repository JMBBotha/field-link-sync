import { describe, expect, it, vi } from "vitest";
import { reconcileAutoLabour, syncAutoLabour, planLabourInsert } from "@/lib/areaLabour";
import { labourFields, isLabourItem } from "@/lib/labour";
import { computeQuoteTotals } from "@/utils/quoteTransformers";
import { buildClientRollup } from "@/lib/clientQuoteRollup";

const areas = [{ id: "bedroom", name: "Bedroom", sort_order: 0, quote_id: "memory-quote", created_at: "", updated_at: "" }];
const unit = (id = "u1", quantity = 1, price = 10000) => ({ id, area_id: "bedroom", item_name: "Samsung 12K INV MW", item_type: "product", quantity, unit_price: price, total_price: price * quantity, metadata: {} });
const labour = (id = "l1", hours = 3.5, auto = true, rate = 680) => ({ id, area_id: "bedroom", ...labourFields(hours, rate, rate !== 680, auto) });
const reconcile = (rows: any[], mode: "per_area" | "job" = "per_area") => reconcileAutoLabour(rows, areas, mode, 3.5, 680);
const labs = (rows: any[]) => rows.filter(isLabourItem);

describe("automatic labour lifecycle, no live writes", () => {
  it("add, remove, swap and two units: one row, shown hours × rate, matching client PDF", () => {
    let rows: any[] = [];
    const stages: any[] = [];
    const check = (name: string, expected: number) => {
      rows = reconcile(rows);
      const l = labs(rows);
      expect(l.length).toBe(expected ? 1 : 0);
      for (const row of l) expect(row.total_price).toBe(row.quantity * row.unit_price);
      const total = computeQuoteTotals(rows, areas);
      const client = buildClientRollup(rows, areas as any).reduce((s, a) => s + a.areaTotal, 0);
      expect(client).toBe(total.subtotal);
      stages.push({ stage: name, labour: l.reduce((s, r) => s + r.total_price, 0), subtotal: total.subtotal, total: total.total });
      expect(stages.at(-1).labour).toBe(expected);
    };
    check("before", 0);
    rows.push(unit()); check("add", 2380);
    rows = rows.filter((r) => r.id !== "u1"); check("remove", 0);
    rows.push(unit("replacement", 1, 12000)); check("swap", 2380);
    rows.push(unit("second")); check("two units", 4760);
    console.info("IN_MEMORY_LABOUR_TOTALS", JSON.stringify(stages));
  });

  it("quantity decrease, move and repeated reconciliation do not accumulate", () => {
    const two = reconcile([unit("u", 2)]);
    expect(labs(two)[0].quantity).toBe(7);
    const one = reconcile(two.map((r: any) => r.id === "u" ? unit("u") : r));
    expect(labs(one)[0].total_price).toBe(2380);
    expect(reconcile(one)).toEqual(one);
    const moved = reconcileAutoLabour(one.map((r: any) => r.id === "u" ? { ...r, area_id: "office" } : r), [...areas, { id: "office", name: "Office" }], "per_area", 3.5, 680);
    expect(labs(moved)).toHaveLength(1);
    expect(labs(moved)[0]).toMatchObject({ area_id: "office", total_price: 2380 });
  });

  it("removes duplicate and orphan automatic rows", () => {
    const rows = reconcile([unit(), labour(), labour("duplicate"), { ...labour("orphan"), area_id: "deleted" }]);
    expect(labs(rows)).toHaveLength(1);
    expect(labs(rows)[0].id).toBe("l1");
    expect(reconcile(rows.filter((r: any) => r.id !== "u1"))).toEqual([]);
  });

  it("preserves manual hours/rate on remove/swap/two units and removes competing auto labour", () => {
    const manual = labour("manual", 5, false, 800);
    for (const units of [[], [unit()], [unit("swap")], [unit("u1", 2)]]) {
      expect(labs(reconcile([...units, manual, labour()]))).toEqual([manual]);
    }
    const autoRate = labour("overridden-rate", 3.5, true, 800);
    expect(labs(reconcile([unit("u", 2), autoRate]))[0]).toMatchObject({ quantity: 7, unit_price: 800, total_price: 5600 });
  });

  it("job mode has one automatic row across areas, manual job labour remains unchanged", () => {
    const rows = reconcile([unit("u", 2)], "job");
    expect(labs(rows)).toHaveLength(1);
    expect(labs(rows)[0]).toMatchObject({ area_id: null, total_price: 4760, metadata: { labour_scope: "job" } });
    expect(labs(reconcile(rows.filter((r: any) => r.id !== "u"), "job"))).toEqual([]);
    const manual = { ...labour("manual", 6, false), area_id: null, metadata: { ...labour("manual", 6, false).metadata, labour_scope: "job" } };
    expect(labs(reconcile([unit(), manual], "job"))).toEqual([manual]);
  });

  it("two queued passes read live state and insert just once", async () => {
    let rows: any[] = [unit()];
    const writer = {
      add: vi.fn(async (r) => { rows = [...rows, { ...r, id: "saved" }]; }),
      update: vi.fn(async (id, r) => { rows = rows.map((i) => i.id === id ? { ...i, ...r } : i); }),
      remove: vi.fn(async (id) => { rows = rows.filter((i) => i.id !== id); }),
    };
    const run = () => syncAutoLabour(rows, areas, "per_area", 3.5, 680, writer);
    let queue = Promise.resolve();
    const enqueue = () => queue = queue.then(run);
    await Promise.all([enqueue(), enqueue()]);
    expect(writer.add).toHaveBeenCalledTimes(1);
    expect(writer.update).not.toHaveBeenCalled();
    expect(labs(rows)[0].total_price).toBe(2380);
    expect(planLabourInsert("per_area", rows, labour("incoming"))).toMatchObject({ kind: "merge", id: "saved", patch: {} });
  });
});