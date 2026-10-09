import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Tech screens must not read cost/invoice tables directly (DB blocks techs; these use sell-only RPCs).
describe("tech cost lockdown — tech screens use RPCs", () => {
  it("used parts, completion and on-site steps don't read supplier_products / job_used_parts directly", () => {
    const used = readFileSync("src/components/UsedPartsSection.tsx", "utf8");
    expect(used).not.toMatch(/from\("supplier_products"\)/);
    expect(used).not.toMatch(/\.select\([^)]*unit_cost/);
    expect(used).toMatch(/get_job_used_parts/);
    expect(used).toMatch(/get_product_sell_options/);
    expect(used).toMatch(/delete_job_used_part/);
    const sheet = readFileSync("src/components/jobs/JobCompletionSheet.tsx", "utf8");
    expect(sheet).not.toMatch(/from\("job_used_parts"/);
    // Finish-job form (Johan 23:11): names/qty only from the packing list + sell-options RPC (prices stripped).
    expect(sheet).toMatch(/get_job_packing_list/);
    expect(sheet).not.toMatch(/sell_excl_vat/);
    const onsite = readFileSync("src/components/jobs/ActualOnSiteStep.tsx", "utf8");
    expect(onsite).not.toMatch(/supplier_products/);
    expect(onsite).toMatch(/get_tech_catalogue/);
    expect(onsite).not.toMatch(/get_product_sell_options/);
  });
  it("lead sheet falls back to deposit chips (no invoice amounts) for techs", () => {
    const lead = readFileSync("src/components/LeadDetailSheet.tsx", "utf8");
    expect(lead).toMatch(/get_field_deposit_chips/);
    expect(lead).toMatch(/remaining/);
  });
});
