import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const src = (p: string) => readFileSync(p, "utf8");

describe("dispatch lockdown for salespeople", () => {
  it("jobs hub forces the pipeline tab for reps and only shows that tab", () => {
    const s = src("src/pages/admin/AdminJobsHubPage.tsx");
    expect(s).toMatch(/isSalesRep \? "pipeline" : wantTab/);
  });
  it("sidebar hides Dispatch for reps", () => {
    expect(src("src/components/admin/AdminSidebar.tsx")).toMatch(/isSalesRep \? \[\] : \[\{ path: "\/admin\/jobs\?tab=dispatch"/);
  });
  it("home hides the Dispatch button for reps", () => {
    expect(src("src/components/AdminHome.tsx")).toMatch(/!isSalesRep && \(/);
  });
  it("unassigned queue denies reps", () => {
    expect(src("src/App.tsx")).toMatch(/unassigned-queue[^\n]*denySalesRep/);
  });
  it("accept dialog pins reps to themselves (no assigning techs)", () => {
    const s = src("src/components/leads/AcceptLeadDialog.tsx");
    expect(s).toMatch(/showAgentPicker=\{!selfOnlyId\}/);
    expect(s).toMatch(/appointment: selfOnlyId \? \{ \.\.\.appt, agentId: selfOnlyId \} : appt/);
  });
  it("migration restricts rep writes and blocks rep status changes", () => {
    const m = src("supabase/migrations/20261009120000_dispatch_lockdown_sales.sql");
    for (const p of ["dl_rep_jobs_insert", "dl_rep_jobs_update", "dl_rep_sched_insert", "dl_rep_sched_update", "dl_rep_assign_insert", "dl_rep_assign_update", "dl_rep_assign_delete"]) {
      expect(m).toContain(`CREATE POLICY ${p}`);
    }
    expect(m).toMatch(/AS RESTRICTIVE/);
    expect(m).toContain("Salespeople can''t change job status");
  });
});
