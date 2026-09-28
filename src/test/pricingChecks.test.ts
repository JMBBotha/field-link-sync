import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { gpCheck, planPriceToTarget, missingMaterials, labourGaps, unitNormKey, serviceNormKey, type CheckLine, type LabourNorm } from "@/lib/pricingChecks";
import type { InstallTemplate } from "@/lib/installTemplates";

const S = { labourCostPerHour: null, gpTargetPercent: 20, commissionPercent: 40 };
const L = (o: Partial<CheckLine>): CheckLine => ({
  id: "x", name: "x", areaId: "a", qty: 1, unitPrice: 100, unitCost: 80, isLabour: false, isService: false,
  isUnit: false, btu: null, kindText: "", installRole: null, isKit: false, kitMetres: null, locked: false, ...o,
});

describe("GP chip", () => {
  it("excludes 'price not set' services and unknown-cost lines, counting them", () => {
    const lines = [
      L({ id: "u", isUnit: true, unitPrice: 1000, unitCost: 900 }), // 10% GP
      L({ id: "s", isService: true, unitPrice: 0, unitCost: null, name: "Package unit" }),
      L({ id: "k", unitPrice: 500, unitCost: null }),
    ];
    const c = gpCheck(lines, 0, S);
    expect(c.notPriced).toBe(2);
    expect(c.gpPercent).toBe(10);
    expect(c.belowTarget).toBe(true);
    expect(c.uplift).toBe(125); // 900 / 0.8 = 1125
  });
  it("unpriced lines never drag GP down", () => {
    const c = gpCheck([L({ unitPrice: 1000, unitCost: 700 }), L({ id: "s", isService: true, unitPrice: 0, unitCost: null })], 0, S);
    expect(c.belowTarget).toBe(false);
    expect(c.gpPercent).toBe(30);
  });
  it("undo payload: discount first, else scale units with exact previous prices", () => {
    const lines = [L({ id: "u", isUnit: true, unitPrice: 1000, unitCost: 900 }), L({ id: "kit", unitPrice: 300, unitCost: 150, locked: true })];
    const c = gpCheck(lines, 0, S);
    const d = planPriceToTarget(lines, { type: "percentage", value: 5 }, c);
    expect(d).toEqual({ kind: "clear_discount", undo: { discount_type: "percentage", discount_value: 5 } });
    const p = planPriceToTarget(lines, { type: null, value: 0 }, c);
    expect(p.kind).toBe("scale");
    if (p.kind !== "scale") return;
    expect(p.undo).toEqual([{ id: "u", unit_price: 1000, total_price: 1000 }]);
    expect(p.patches.map((x) => x.id)).toEqual(["u"]); // locked kit untouched
    const after = gpCheck(lines.map((l) => (l.id === "u" ? { ...l, unitPrice: p.patches[0].unit_price } : l)), 0, S);
    expect(after.belowTarget).toBe(false);
  });
});

const tpl: InstallTemplate = {
  id: "t", name: "9-12K", min_btu: 9000, max_btu: 12000, is_active: true, sort_order: 1,
  items: [
    { id: "1", role: "piping_kit", bundle_id: null, product_code: null, default_qty: 1, default_length_m: 3, included: true, sort_order: 1 },
    { id: "2", role: "bracket", bundle_id: null, product_code: "BR1", default_qty: 1, default_length_m: null, included: true, sort_order: 2 },
    { id: "3", role: "cable_interconnect", bundle_id: null, product_code: "C1", default_qty: 1, default_length_m: null, included: true, sort_order: 3 },
    { id: "4", role: "trunking_main", bundle_id: null, product_code: "T1", default_qty: 1, default_length_m: null, included: true, sort_order: 4 },
  ],
};

describe("missing materials", () => {
  it("flags groups the template expects but the area lacks", () => {
    const lines = [
      L({ id: "u", areaId: "lounge", isUnit: true, btu: 12000 }),
      L({ id: "k", areaId: "lounge", isKit: true, installRole: "piping_kit" }),
      L({ id: "t", areaId: "lounge", name: "Trunking 100x40" }),
      L({ id: "u2", areaId: "bed", isUnit: true, btu: 12000 }),
      L({ id: "b", areaId: "bed", installRole: "bracket" }), L({ id: "c", areaId: "bed", installRole: "cable_interconnect" }),
      L({ id: "k2", areaId: "bed", isKit: true }), L({ id: "d", areaId: "bed", installRole: "trunking_main" }),
    ];
    const m = missingMaterials(lines, [tpl]);
    expect(m).toEqual([{ areaId: "lounge", unitId: "u", missing: ["bracket", "electrical"], roles: ["bracket", "cable_interconnect"] }]);
  });
  it("no template → only a piping kit is expected", () => {
    expect(missingMaterials([L({ id: "u", isUnit: true, btu: 60000 })], [tpl])[0].missing).toEqual(["kit"]);
  });
});

const norms: LabourNorm[] = [
  ["split_upto_12k", 4], ["split_18_24k", 5], ["split_30k_plus", 6], ["cassette_install", 8], ["ducted_install", 12],
  ["removal", 1.5], ["service_split", 1], ["piping_extra_per_m", 0.25],
].map(([key, hours]) => ({ key: key as string, label: key as string, hours: hours as number }));

describe("labour norms", () => {
  it("matches units by kind + BTU and services by catalog name", () => {
    expect(unitNormKey("Samsung wall split", 12000)).toBe("split_upto_12k");
    expect(unitNormKey("wall split", 18000)).toBe("split_18_24k");
    expect(unitNormKey("wall split", 36000)).toBe("split_30k_plus");
    expect(unitNormKey("Midea Cassette 24K", 24000)).toBe("cassette_install");
    expect(unitNormKey("Hideaway ducted", 36000)).toBe("ducted_install");
    expect(serviceNormKey("Removal of existing air conditioner")).toBe("removal");
    expect(serviceNormKey("Removal and reinstallation of existing air conditioner")).toBe("removal_reinstall");
    expect(serviceNormKey("Service of cassette and hideaway systems")).toBe("service_cassette_hideaway");
    expect(serviceNormKey("Ducted system")).toBe("service_ducted");
    expect(serviceNormKey("Installation of quoted air conditioner")).toBeNull();
  });
  it("area gap = units + services + extra kit metres, rounded up to 0.5 h", () => {
    const g = labourGaps([
      L({ id: "u", isUnit: true, btu: 12000, kindText: "wall split" }),
      L({ id: "r", isService: true, name: "Removal of existing air conditioner" }),
      L({ id: "k", isKit: true, kitMetres: 5 }),
      L({ id: "lab", isLabour: true, qty: 2, labourHours: 2 }),
    ], norms);
    expect(g).toEqual([{ areaId: "a", hours: 2, norm: 6, parts: ["split_upto_12k", "removal", "piping_extra_per_m"] }]);
    expect(labourGaps([L({ isUnit: true, btu: 9000 }), L({ id: "l", isLabour: true, labourHours: 4 })], norms)).toEqual([]);
  });
});

describe("cost never reaches client views", () => {
  it("client page, client PDF document and send dialog never render staff cost", () => {
    for (const f of ["src/components/client/ClientProposalView.tsx", "src/components/quoting/SendQuoteDialog.tsx"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/staffNote|PricingChecksRow|StaffMarginCard|lineUnitCostOrNull|showCost/);
    }
    const doc = readFileSync("src/components/quoting/EstimateDocument.tsx", "utf8");
    // staff note is only ever rendered inside edit mode and is hidden from print + capture
    expect(doc).toMatch(/line\.staffNote && \(\s*<div data-html2canvas-ignore className="[^"]*print:hidden/);
    expect(doc).not.toMatch(/unit_cost|lineUnitCostOrNull|cost_price/);
  });
});
