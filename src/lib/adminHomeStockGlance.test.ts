import { describe, expect, it } from "vitest";
import { MASSAIR_CT_ID, MASSAIR_IND_ID, TEST_HVAC_ID } from "@/lib/adminHomeCashFlow";
import { buildStockGlance, runMetres, type StockJob, type StockQuoteLine } from "@/lib/adminHomeStockGlance";

const CT = MASSAIR_CT_ID;
const job = (over: Partial<StockJob> & { id: string }): StockJob => ({
  company_id: CT, title: "House 12", status: "scheduled", quote_id: "q1", job_type: "installation", customer_name: "Ndlovu", ...over,
});
const line = (over: Partial<StockQuoteLine> & { id: string; item_name: string }): StockQuoteLine => ({
  quote_id: "q1", quantity: 1, length: null, is_bundle: false, parent_item_id: null, ...over,
});

describe("stock glance", () => {
  it("draws pipe, lagging, cable and a bracket from the lines on a 9 000 BTU job", () => {
    const glance = buildStockGlance({
      companyId: CT,
      jobs: [job({ id: "j1" })],
      lines: [
        line({ id: "u", item_name: "9000 BTU wall mount", product_id: "pu", product_type: "ac_unit", product_code: "FCMI-09", pipe_liquid: "1/4", pipe_gas: "3/8", quantity: 1 }),
        line({ id: "k", item_name: "Piping kit 1/4 & 3/8", is_bundle: true, length: 10, pipe_liquid: "1/4", pipe_gas: "3/8", quantity: 1 }),
        line({ id: "lag", item_name: "Lagging", product_id: "pl", quantity: 10, length: 10, price_per_unit_label: "m", sold_in_length: true }),
        line({ id: "cab", item_name: "4 core + earth cable", product_id: "pc", quantity: 10, length: 10, price_per_unit_label: "m" }),
        line({ id: "br", item_name: "Wall bracket", product_id: "pb", quantity: 1 }),
        line({ id: "co", item_name: "Call-out fee", quantity: 1, item_type: "labour" }),
      ],
      items: [
        { id: "s14", company_id: CT, label: "Copper 1/4", unit: "m", cache_on_hand: 40, minimum: 15 },
        { id: "s38", company_id: CT, label: "Copper 3/8", unit: "m", cache_on_hand: 8, minimum: 15 },
        { id: "slag", company_id: CT, label: "Lagging", product_id: "pl", unit: "m", cache_on_hand: 20, minimum: null },
        { id: "scab", company_id: CT, label: "4 core + earth", product_id: "pc", unit: "m", cache_on_hand: 30 },
        { id: "sbr", company_id: CT, label: "Wall bracket", product_id: "pb", unit: "each", cache_on_hand: 6, minimum: 8 },
        { id: "sun", company_id: CT, label: "FCMI-09", product_id: "pu", unit: "each", cache_on_hand: 0 },
      ],
    });
    const by = (label: string) => glance.candles.find((c) => c.label === label)!;
    expect(by("Copper 1/4")).toMatchObject({ onHand: 40, needed: 10, minimum: 15, unit: "m" });
    expect(by("Copper 3/8")).toMatchObject({ onHand: 8, needed: 10, minimum: 15 });
    expect(by("Lagging").needed).toBe(10);
    expect(by("4 core + earth").needed).toBe(10);
    expect(by("Wall bracket").needed).toBe(1);
    expect(by("FCMI-09").needed).toBe(1);
    expect(glance.candles.some((c) => /call-out/i.test(c.label))).toBe(false);
    expect(glance.gaps.some((g) => /10 m/.test(g.detail))).toBe(false);
  });

  it("does not invent 10 m or a pipe pair when the line does not say them", () => {
    expect(runMetres(line({ id: "x", item_name: "Piping kit", quantity: 1, length: null }))).toBeNull();
    const missing = buildStockGlance({
      companyId: CT,
      jobs: [job({ id: "j1" })],
      lines: [
        line({ id: "u", item_name: "9000 BTU wall mount", product_type: "ac_unit", product_code: "FCMI-09", quantity: 1 }),
        line({ id: "k", item_name: "Piping kit 1/4 & 3/8", is_bundle: true, quantity: 1, length: null, pipe_liquid: "1/4", pipe_gas: "3/8" }),
      ],
    });
    expect(missing.candles.filter((c) => c.unit === "m")).toHaveLength(0);
    expect(missing.gaps.some((g) => /run length is not on this line/.test(g.detail))).toBe(true);
    expect(missing.candles.some((c) => c.needed === 10)).toBe(false);

    const noLines = buildStockGlance({
      companyId: CT,
      jobs: [job({ id: "j1" })],
      lines: [line({ id: "u", item_name: "9000 BTU wall mount", product_type: "ac_unit", product_code: "FCMI-09", pipe_liquid: "1/4", pipe_gas: "3/8" })],
    });
    expect(noLines.candles.filter((c) => /copper/i.test(c.label))).toHaveLength(0);
    expect(noLines.gaps.some((g) => /Nothing was invented/.test(g.detail))).toBe(true);
  });

  it("uses an active allowance once, and ignores an inactive stub", () => {
    const glance = buildStockGlance({
      companyId: CT,
      today: "2026-11-06",
      jobs: [job({ id: "j1", job_type: "installation" })],
      lines: [line({ id: "u", item_name: "9000 BTU wall mount", product_type: "ac_unit", product_code: "FCMI-9", quantity: 1 })],
      allowances: [
        { id: "a1", company_id: CT, job_type: "install", unit_size: "9000", item_label: "Brackets", stock_unit: "each", qty: 4, active: true, effective_from: "2026-01-01" },
        { id: "a2", company_id: CT, job_type: "install", unit_size: "9000", item_label: "Copper pair", stock_unit: "m", qty: 0, active: false, effective_from: "2026-01-01" },
        { id: "a3", company_id: MASSAIR_IND_ID, job_type: "install", unit_size: "9000", item_label: "Drain pipe", stock_unit: "m", qty: 12, active: true, effective_from: "2026-01-01" },
      ],
    });
    expect(glance.candles.find((c) => c.label === "Brackets")?.needed).toBe(4);
    expect(glance.candles.some((c) => /copper|drain/i.test(c.label))).toBe(false);
  });

  it("reduces what is still needed by what the job already drew, and estimates loss on small items", () => {
    const glance = buildStockGlance({
      companyId: CT,
      jobs: [
        job({ id: "soon", status: "scheduled", quote_id: "q-soon" }),
        job({ id: "done", status: "completed", quote_id: "q-done", title: "Finished house" }),
      ],
      lines: [
        line({ id: "a", quote_id: "q-soon", item_name: "Copper 1/4", product_id: "pcu", quantity: 10, length: 10, price_per_unit_label: "m" }),
        line({ id: "b", quote_id: "q-done", item_name: "Copper 1/4", product_id: "pcu", quantity: 10, length: 10, price_per_unit_label: "m" }),
      ],
      items: [{ id: "s14", company_id: CT, label: "Copper 1/4", product_id: "pcu", unit: "m", cache_on_hand: 0, minimum: 5 }],
      moves: [
        { company_id: CT, stock_item_id: "s14", product_id: "pcu", bucket: "material_pool", kind: "receive", qty: 30, item_label: "Copper 1/4" },
        { company_id: CT, stock_item_id: "s14", product_id: "pcu", job_id: "soon", bucket: "material_pool", kind: "use", qty: -4, item_label: "Copper 1/4" },
        { company_id: CT, stock_item_id: "s14", product_id: "pcu", job_id: "done", bucket: "material_pool", kind: "use", qty: -12, item_label: "Copper 1/4" },
        { company_id: MASSAIR_IND_ID, stock_item_id: "s14", bucket: "material_pool", kind: "receive", qty: 100, item_label: "Copper 1/4" },
      ],
      counts: [{ company_id: CT, stock_item_id: "s14", system_qty: 30, counted_qty: 26 }],
    });
    const copper = glance.candles.find((c) => c.label === "Copper 1/4")!;
    expect(copper.onHand).toBe(30 - 4 - 12);
    expect(copper.needed).toBe(6);
    expect(copper.minimum).toBe(5);
    expect(copper.loss).toMatchObject({ expected: 10, actual: 12, variance: 2, countGap: -4 });
    expect(copper.small).toBe(true);
  });

  it("does not pick up another company's stock or Test HVAC", () => {
    const glance = buildStockGlance({
      companyId: CT,
      jobs: [job({ id: "ind", company_id: MASSAIR_IND_ID, quote_id: "qi" })],
      lines: [line({ id: "x", quote_id: "qi", item_name: "Copper 1/2", quantity: 50, length: 50, price_per_unit_label: "m" })],
      items: [
        { id: "theirs", company_id: MASSAIR_IND_ID, label: "Copper 1/2", unit: "m", cache_on_hand: 80 },
        { id: "test", company_id: TEST_HVAC_ID, label: "Test pipe", unit: "m", cache_on_hand: 9 },
      ],
    });
    expect(glance.candles).toHaveLength(0);
    expect(buildStockGlance({ companyId: TEST_HVAC_ID, items: [{ id: "t", company_id: TEST_HVAC_ID, label: "Test pipe", unit: "m", cache_on_hand: 9 }] }).candles).toHaveLength(0);
  });
});
