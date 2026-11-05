import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { SAFE_PROFILE_KEYS } from "@/lib/companyProfileSafe";

const MONEY = ["default_hourly_rate", "banking_details", "payfast_merchant_id", "payfast_merchant_key", "default_install_labour_hours"];

describe("P9 tech company-settings money", () => {
  it("safe profile exposes no money fields", () => {
    for (const k of MONEY) expect(SAFE_PROFILE_KEYS as string[]).not.toContain(k);
    expect(SAFE_PROFILE_KEYS).toContain("default_deposit_percentage");
  });
  it("migration blocks techs from company_settings and the RPC returns no money", () => {
    const sql = readFileSync("supabase/migrations/20261009170000_p9_website_intake_tech_money.sql", "utf8");
    expect(sql).toMatch(/p9_cs_no_techs[\s\S]*RESTRICTIVE FOR SELECT[\s\S]*NOT public\.is_field_tech_only\(auth\.uid\(\)\)/);
    const fn = sql.slice(sql.indexOf("company_profile_safe()"));
    for (const k of MONEY) expect(fn).not.toContain(k);
  });
  it("settings page stays admin-only", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).toMatch(/path="settings" element={<RequireRole allowedRoles={\["admin"\]}>/);
  });
  it("website intake uses the configured company only for website sources", () => {
    const rw = readFileSync("supabase/functions/receive-website-lead/index.ts", "utf8");
    const ing = readFileSync("supabase/functions/ingest-lead/index.ts", "utf8");
    expect(rw).toContain("websiteLeadCompanyId(supabase)");
    expect(ing).toMatch(/!companyId && source === "website_form"/);
    for (const f of ["receive-vapi-lead", "twilio-inbound-call"]) {
      expect(readFileSync(`supabase/functions/${f}/index.ts`, "utf8")).not.toContain("websiteLeadCompanyId");
    }
  });
});
