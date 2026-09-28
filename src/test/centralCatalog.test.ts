import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { canReadMasterCatalog, canWriteMasterCatalog, type NetworkStatus } from "@/lib/catalogAccess";
import { computeProductPricing } from "@/lib/pricing";

describe("master catalogue access", () => {
  const u = (companyIsMaster: boolean, networkStatus: NetworkStatus | null, roles: string[] = []) => ({ companyIsMaster, networkStatus, roles });
  it("master admin reads + writes; master staff read only", () => {
    expect(canReadMasterCatalog(u(true, null, ["admin", "field_agent"]))).toBe(true);
    expect(canWriteMasterCatalog(u(true, null, ["admin", "field_agent"]))).toBe(true);
    expect(canWriteMasterCatalog(u(true, null, ["dispatcher"]))).toBe(false);
    expect(canReadMasterCatalog(u(true, null, ["field_agent"]))).toBe(true);
  });
  it("approved member reads, never writes (even as its own admin)", () => {
    expect(canReadMasterCatalog(u(false, "approved", ["admin"]))).toBe(true);
    expect(canWriteMasterCatalog(u(false, "approved", ["admin"]))).toBe(false);
  });
  it.each(["pending", "rejected", "removed", null] as const)("%s membership sees nothing", (s) => {
    expect(canReadMasterCatalog(u(false, s, ["admin"]))).toBe(false);
    expect(canWriteMasterCatalog(u(false, s, ["admin"]))).toBe(false);
  });
});

describe("SKU baseline prices unchanged", () => {
  it("COPRL001: cost 800.87 × 2 = 1601.74 per 15.24 m length ≈ 105.10/m", () => {
    const p = computeProductPricing({ cost_price: 800.87, cost_excl_vat: 800.87, markup_percent: 100 });
    expect(p.sellExVat).toBe(1601.74);
    expect(Math.round((p.sellExVat / 15.24) * 100) / 100).toBe(105.1);
  });
  it("AR40F24C0AG/FA: 25% units markup → R17 825,22", () => {
    const p = computeProductPricing({ cost_price: 14260.176, cost_excl_vat: 14260.176, markup_percent: 25 });
    expect(p.sellExVat).toBe(17825.22);
  });
});

describe("one picker path", () => {
  it("quote builder products: archived=false + active, no company filter", () => {
    const src = readFileSync("src/hooks/useQuoteBuilderProducts.ts", "utf8");
    expect(src).toMatch(/archived\.eq\.false/);
    expect(src).toMatch(/is_active", true/);
    expect(src).not.toMatch(/company_id/);
  });
});
