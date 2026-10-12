import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { isAcUnitLine, acUnitFromProduct, looksLikeAcModelCode, isClearlyNotAcUnit } from "@/lib/lineDisplay";
import { countAcUnits, reconcileAutoLabour } from "@/lib/areaLabour";
import { jobToCard } from "@/lib/cardModel";
import { UPCOMING_JOBS_SELECT } from "@/components/AdminHome";

const line = (item_name: string, extra: any = {}) => ({ id: item_name, item_name, item_type: "product", quantity: 1, area_id: "a1", parent_item_id: null, metadata: {}, ...extra });
const areas = [{ id: "a1", name: "Lounge" }];
const autoRow = { id: "lab1", item_name: "Labour", item_type: "labour", quantity: 3.5, unit_price: 680, area_id: "a1", parent_item_id: null, metadata: { labour: true, labour_auto: true, hours: 3.5, rate: 680 } };

describe("AC detection from product data, name as fallback", () => {
  it.each(["AR24BSAAAWK/FA", "AR12TXHQASINXFA", "MSAG-12HRN1", "MOX230-24HFN8", "FTXM35R", "MSZ-AP25VG", "GWH12QC", "S12EQ", "ASYG12KMTB", "42QHC012DS"])(
    "model-code-only name %s counts as a unit", (n) => {
      expect(looksLikeAcModelCode(n)).toBe(true);
      expect(isAcUnitLine(line(n))).toBe(true);
    });
  it("product category/type/capacity decide before the name", () => {
    expect(acUnitFromProduct({ category: "Split Units" })).toBe(true);
    expect(acUnitFromProduct({ subcategory: "Indoor" })).toBe(true);
    expect(acUnitFromProduct({ product_type: "Cassette" })).toBe(true);
    expect(acUnitFromProduct({ capacity_btu: 24000 })).toBe(true);
    expect(acUnitFromProduct({ kw: 7.1 })).toBe(true);
    expect(acUnitFromProduct({ category: "Copper pipe" })).toBe(false);
    expect(acUnitFromProduct({ category: "Controls" })).toBe(false);
    expect(acUnitFromProduct({})).toBe(null);
    expect(isAcUnitLine(line("XYZ-0001"), { capacity_btu: 18000 })).toBe(true);
    expect(isAcUnitLine(line("AR24BSAAAWK/FA"), { category: "Accessories" })).toBe(false);
  });
  it("materials and controllers with codes are not units", () => {
    expect(isAcUnitLine(line("Copper pipe 1/4 15m"))).toBe(false);
    expect(isAcUnitLine(line("MWR-WE10 wired controller"))).toBe(false);
  });
  it("Samsung model-code unit gets auto labour (3.5 h per unit)", () => {
    const rows = reconcileAutoLabour([line("AR24BSAAAWK/FA", { quantity: 2 })] as any, areas, "per_area", 3.5, 680);
    const lab = rows.find((r: any) => r.item_type === "labour") as any;
    expect(countAcUnits([line("AR24BSAAAWK/FA", { quantity: 2 })] as any)).toBe(2);
    expect(lab.metadata.hours).toBe(7);
  });
  it("never deletes existing labour when detection cannot prove the units are gone", () => {
    const unknown = line("Unit 7 (see spec)", { product_id: "p1", product: {} });
    expect(isClearlyNotAcUnit(unknown)).toBe(false);
    const rows = reconcileAutoLabour([unknown, autoRow] as any, areas, "per_area", 3.5, 680);
    expect(rows.find((r: any) => r.id === "lab1")).toBeTruthy();
  });
  it("still removes auto labour when only materials remain", () => {
    const rows = reconcileAutoLabour([line("Copper pipe 1/4"), autoRow] as any, areas, "per_area", 3.5, 680);
    expect(rows.find((r: any) => r.id === "lab1")).toBeFalsy();
  });
});

describe("Admin home Upcoming Jobs shows the tech", () => {
  it("query embeds assignments + tech profile", () => {
    expect(UPCOMING_JOBS_SELECT).toMatch(/assignments\(.*profiles!assignments_profile_id_fkey\(full_name/);
  });
  it("assigned job shows the tech name, not Unassigned; null stays Unassigned", () => {
    const sf = new Date(Date.now() + 86400000).toISOString();
    const assigned = jobToCard({ id: "j1", title: "Install", status: "scheduled", scheduled_for: sf,
      assignments: [{ id: "x", profile_id: "t", status: "accepted", profiles: { full_name: "Thabo Mokoena" } }] } as any);
    expect(assigned.assigneeName).toBe("Thabo Mokoena");
    expect(assigned.statusKey).not.toBe("unassigned");
    const none = jobToCard({ id: "j2", title: "Install", status: "scheduled", scheduled_for: sf, assignments: [] } as any);
    expect(none.statusKey).toBe("unassigned");
  });
});
