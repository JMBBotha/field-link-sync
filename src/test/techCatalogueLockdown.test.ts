import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
const src = (p: string) => readFileSync(p, "utf8");

describe("Tech catalogue lockdown (Johan 01:53)", () => {
  it("tech pickers use the price-free get_tech_catalogue", () => {
    for (const f of ["src/components/jobs/JobCompletionSheet.tsx", "src/components/jobs/ActualOnSiteStep.tsx"]) {
      expect(src(f)).toMatch(/get_tech_catalogue/);
      expect(src(f)).not.toMatch(/get_product_sell_options|sell_excl_vat/);
    }
    const opts = src("src/hooks/useProductOptions.ts");
    expect(opts).toMatch(/techOnly\s*\n?\s*\? \(supabase\.rpc as any\)\("get_tech_catalogue"\)/);
    const used = src("src/components/UsedPartsSection.tsx");
    expect(used).toMatch(/if \(showCost\) \{\s*const \{ data, error \} = await \(supabase\.rpc as any\)\("get_product_sell_options"\)/);
    expect(used).toMatch(/get_tech_catalogue/);
  });
  it("DB: safe RPC returns only id/name/model/category/unit/length; priced RPC refuses techs", () => {
    const m = src("supabase/migrations/20261010015500_tech_catalogue_lockdown.sql");
    const fn = m.slice(m.indexOf("get_tech_catalogue()"), m.indexOf("REVOKE ALL ON FUNCTION public.get_tech_catalogue"));
    expect(fn).toMatch(/RETURNS TABLE\(id uuid, name text, model text, category text, unit text, length numeric, length_unit text\)/);
    expect(fn).not.toMatch(/cost|price|markup|sell/i);
    expect(m).toMatch(/NOT public\.is_field_tech_only\(auth\.uid\(\)\) \/\*tech_no_prices\*\//);
  });
  it("'Part paid / balance due' chip hidden from techs", () => {
    const fa = src("src/pages/FieldAgent.tsx");
    expect(fa).not.toMatch(/invoice=\{installInvoicesByLead\[lead\.id\] \?\? null\}/);
    expect((fa.match(/invoice=\{canInvoice \? \(installInvoicesByLead/g) || []).length).toBe(6);
    expect(src("src/pages/admin/AdminMyJobsPage.tsx")).toContain("{!hideAmount && assignment.job_type");
  });
});
