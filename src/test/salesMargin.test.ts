import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { computeMargin, lineMargin, sellForTarget, commissionOn, type MarginLineInput, type MarginSettings } from "@/lib/margin";
import { canSeeMargin } from "@/lib/marginAccess";
import { buildClientRollup } from "@/lib/clientQuoteRollup";

const S: MarginSettings = { labourCostPerHour: 250, gpTargetPercent: 20, commissionPercent: 40 };
const L = (o: Partial<MarginLineInput>): MarginLineInput => ({ id: "x", name: "x", areaId: "a", qty: 1, unitPrice: 0, unitCost: null, isLabour: false, ...o });

describe("margin maths", () => {
  it("line GP from stored cost (units 25% markup → 20% GP)", () => {
    const l = lineMargin(L({ unitPrice: 12500, unitCost: 10000 }), S);
    expect(l).toMatchObject({ sell: 12500, cost: 10000, gp: 2500, gpPercent: 20, status: "ok" });
  });
  it("area + job roll-up", () => {
    const m = computeMargin([
      L({ id: "u", unitPrice: 12500, unitCost: 10000 }),
      L({ id: "k", areaId: "b", qty: 2, unitPrice: 200, unitCost: 100 }),
    ], 0, S);
    expect(m.areas.a.gp).toBe(2500);
    expect(m.areas.b).toMatchObject({ sell: 400, cost: 200, gp: 200, gpPercent: 50 });
    expect(m.job).toMatchObject({ sell: 12900, cost: 10200, gp: 2700 });
  });
  it("discount lowers sell and GP, pro-rata to areas", () => {
    const m = computeMargin([L({ id: "1", unitPrice: 1000, unitCost: 500 }), L({ id: "2", areaId: "b", unitPrice: 1000, unitCost: 500 })], 200, S);
    expect(m.job).toMatchObject({ sell: 1800, gp: 800, discount: 200 });
    expect(m.areas.a.sell).toBe(900);
    expect(m.areas.b.gp).toBe(400);
  });
  it("labour: rate set → hours × rate; not set → excluded + flag", () => {
    const lab = L({ id: "l", qty: 3, unitPrice: 680, isLabour: true });
    expect(lineMargin(lab, S)).toMatchObject({ sell: 2040, cost: 750, gp: 1290 });
    const m = computeMargin([lab, L({ id: "u", unitPrice: 1250, unitCost: 1000 })], 0, { ...S, labourCostPerHour: null });
    expect(m.lines[0].status).toBe("labour_cost_not_set");
    expect(m.labourExcluded).toBe(true);
    expect(m.job).toMatchObject({ sell: 1250, gp: 250, gpPercent: 20 });
  });
  it("unknown-cost lines are counted, not 100% profit", () => {
    const m = computeMargin([L({ id: "q", unitPrice: 999 }), L({ id: "u", unitPrice: 200, unitCost: 100 })], 0, S);
    expect(m.unknownCostCount).toBe(1);
    expect(m.job).toMatchObject({ sell: 200, gp: 100 });
    expect(m.lines[0]).toMatchObject({ status: "cost_unknown", gp: null });
  });
  it("target check at job level + commission + if priced correctly", () => {
    const m = computeMargin([L({ unitPrice: 1100, unitCost: 1000 })], 0, S);
    expect(m.job.gpPercent).toBe(9.09);
    expect(m.belowTarget).toBe(true);
    expect(m.commission).toBe(40);
    expect(sellForTarget(1000, 20)).toBe(1250);
    expect(m.commissionIfPricedCorrectly).toBe(100);
    const ok = computeMargin([L({ unitPrice: 1250, unitCost: 1000 })], 0, S);
    expect(ok.belowTarget).toBe(false);
    expect(ok.commissionIfPricedCorrectly).toBeNull();
  });
  it("commission never below 0", () => {
    expect(commissionOn(-500, 40)).toBe(0);
    expect(computeMargin([L({ unitPrice: 800, unitCost: 1000 })], 0, S).commission).toBe(0);
  });
});

describe("margin visibility", () => {
  const q = { sales_engineer_id: "rep", created_by: "x", owner_id: null };
  const base = { userId: "u", roles: [] as string[], dispatchRole: null as string | null, quote: q };
  it("admin always (incl. admin + field_agent)", () => {
    expect(canSeeMargin({ ...base, roles: ["admin", "field_agent"] })).toBe(true);
  });
  it("office dispatcher sees all; sales rep only own", () => {
    expect(canSeeMargin({ ...base, roles: ["dispatcher"], dispatchRole: "technician" })).toBe(true);
    expect(canSeeMargin({ ...base, roles: ["dispatcher"], dispatchRole: "sales" })).toBe(false);
    expect(canSeeMargin({ ...base, userId: "rep", roles: ["dispatcher"], dispatchRole: "sales" })).toBe(true);
    expect(canSeeMargin({ ...base, userId: "x", roles: ["dispatcher"], dispatchRole: "sales" })).toBe(true);
  });
  it("field agents and agent mode never", () => {
    expect(canSeeMargin({ ...base, userId: "rep", roles: ["field_agent"], dispatchRole: "sales" })).toBe(false);
    expect(canSeeMargin({ ...base, roles: ["admin"], mode: "agent" })).toBe(false);
    expect(canSeeMargin({ ...base, userId: null, roles: ["admin"] })).toBe(false);
  });
});

describe("client view never shows cost/GP/commission", () => {
  it("client roll-up output carries no cost fields even when lines store them", () => {
    const r = buildClientRollup([
      { id: "u", item_name: "Samsung", area_id: "a", quantity: 1, unit_price: 12500, category: "Air Conditioning", metadata: { unit_cost: 10000 } } as any,
    ], [{ id: "a", name: "Lounge" }]);
    expect(JSON.stringify(r)).not.toMatch(/cost|gp|profit|commission|margin/i);
  });
  it("client page and PDF document sources never reference margin/cost", () => {
    for (const f of ["src/components/client/ClientProposalView.tsx", "src/components/quoting/EstimateDocument.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/StaffMarginCard|lib\/margin|unit_cost|commission|gpPercent/);
    }
  });
});
