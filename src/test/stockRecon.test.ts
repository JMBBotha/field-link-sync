import { describe, it, expect } from "vitest";
import { buildPreview, type Product } from "@/lib/stockReceive";
import { buildRecon } from "@/lib/stockRecon";

const products: Product[] = [
  { id: "p-fcmi12", product_code: "FCMI-12", name: "Test Inverter 12K", cost_price: 5000, product_type: "ac_unit", price_per_unit_label: "each" },
  { id: "p-fcmi24", product_code: "FCMI-24", name: "Test Inverter 24K", cost_price: 10000, product_type: "ac_unit", price_per_unit_label: "each" },
  { id: "p-gas", product_code: "G005", name: "GAS - R410 DISP 11.3KG", cost_price: 2260, product_type: "consumable", price_per_unit_label: "each" },
];
const jobs = [{ id: "job-a", label: "Job A · Test Street", has_quote: true }, { id: "job-b", label: "Job B · Demo Road", has_quote: true }];
const quote = [{ job_id: "job-a", product_id: "p-fcmi24", quantity: 1 }, { job_id: "job-b", product_id: "p-fcmi12", quantity: 2 }];
const L = (n: number, m: string, q = 1) => ({ line_no: n, description: m, model_number: m, qty: q, unit_price_excl: null });
const assign = (rows: any[], map: Record<number, string | null>) => rows.map((r, i) => (i in map ? { ...r, action: map[i] ? "reserve" : "stock", job_id: map[i] } : r));

describe("receive reconciliation", () => {
  it("OK: both halves per job, quantities match the quote, totals per job", () => {
    const rows = assign(buildPreview("delivery_note", [L(1, "FCMI-24-P"), L(2, "FCMI-24X-P"), L(3, "FCMI-12-P", 2), L(4, "FCMI-12X-P", 2), L(5, "G005", 1)], products), { 0: "job-a", 1: "job-a", 2: "job-b", 3: "job-b" });
    const r = buildRecon(rows, jobs, quote);
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.jobs.find((j) => j.job_id === "job-a")!.cost).toBeCloseTo(10000);
    expect(r.jobs.find((j) => j.job_id === "job-b")!.cost).toBeCloseTo(10000);
    expect(r.jobs.find((j) => j.label === "Materials pool")!.cost).toBeCloseTo(2260);
    expect(r.total).toBeCloseTo(22260);
  });
  it("blocks: Lite look-alike unmatched, indoor without outdoor, qty vs quote, missing job", () => {
    const rows = assign(buildPreview("delivery_note", [L(1, "FCMI-24-P"), L(2, "FCMI-L-12"), L(3, "FCMI-12-P", 1), L(4, "FCMI-12X-P", 1)], products), { 0: "job-a", 2: "job-b", 3: "job-b" });
    const r = buildRecon(rows, jobs, quote);
    expect(r.ok).toBe(false);
    const all = r.problems.join("\n");
    expect(all).toMatch(/FCMI-L-12.*Not matched/);
    expect(all).toMatch(/indoor without its outdoor half/);
    expect(all).toMatch(/note has 1, quote has 2/);
    const none = buildRecon([{ ...rows[0], job_id: null }], jobs, quote);
    expect(none.problems.join()).toMatch(/No job chosen/);
  });
  it("blocks a unit that is not on the job's quote; materials stay in the pool", () => {
    const gas = assign(buildPreview("delivery_note", [L(1, "G005")], products), { 0: "job-a" });
    expect(buildRecon(gas, jobs, quote).problems.join()).toMatch(/pool/);
    const unit = assign(buildPreview("delivery_note", [L(1, "FCMI-12-P"), L(2, "FCMI-12X-P")], products), { 0: "job-a", 1: "job-a" });
    expect(buildRecon(unit, jobs, quote).problems.join()).toMatch(/not on this job's quote/);
    const reserved = buildPreview("delivery_note", [L(1, "FCMI-24-P"), L(2, "FCMI-24X-P")], products, [], "job-a");
    expect(buildRecon(reserved, [{ id: "job-a", label: "A", has_quote: false }], []).ok).toBe(true);
  });
});
