import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

describe("P4 tech-assignment gap", () => {
  it("accept dialog pins non-office users (techs, salespeople) to themselves", () => {
    const s = readFileSync("src/components/leads/AcceptLeadDialog.tsx", "utf8");
    expect(s).toMatch(/const selfOnlyId = isSalesRep \|\| \(!roleLoading && !isAdmin && !isDispatcher\) \? user\?\.id : undefined;/);
    expect(s).toMatch(/showAgentPicker=\{!selfOnlyId\}/);
  });
  it("migration restricts assignment writes to self or office", () => {
    const m = readFileSync("supabase/migrations/20261009140000_p4_company_isolation.sql", "utf8");
    expect(m).toMatch(/p4_assign_ins ON public\.assignments AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK \(profile_id = auth\.uid\(\) OR public\.p4_is_ops\(\)\)/);
    expect(m).toMatch(/role NOT IN \('platform_super_admin','platform_ops'\)/);
  });
});
