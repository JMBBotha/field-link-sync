import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { attachOwnUnassigned, jobTechLocationAllowed, salesBookedOrAssigned, scopeFromRpc, type SalesJobClaim } from "./salesJobVisibility";

const rep = "420c7731-e8a4-4355-80ca-51c684b42a2c";
const other = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const admin = "1e795a9b-f8bd-4af5-8f28-5e0426101daa";
const tech = "09a7f5af-0000-4000-8000-000000000001";

const install = (over: Partial<SalesJobClaim> = {}): SalesJobClaim => ({
  createdBy: other,
  assigneeIds: [tech],
  quoteSalesEngineerIds: [other],
  ...over,
});

describe("salesBookedOrAssigned", () => {
  it("shows a technician installation the salesperson booked", () => {
    expect(salesBookedOrAssigned(rep, install({ createdBy: rep }))).toBe(true);
    expect(salesBookedOrAssigned(rep, install({ assignedByIds: [rep] }))).toBe(true);
    expect(salesBookedOrAssigned(rep, install({ quoteSalesEngineerIds: [rep] }))).toBe(true);
    expect(salesBookedOrAssigned(rep, install({ leadCreatedBy: rep }))).toBe(true);
    expect(salesBookedOrAssigned(rep, install({ leadAssignedByIds: [rep] }))).toBe(true);
    expect(salesBookedOrAssigned(rep, install({ customerAssignedRepId: rep }))).toBe(true);
    expect(salesBookedOrAssigned(rep, install({ customerOwnerRepId: rep }))).toBe(true);
    expect(salesBookedOrAssigned(rep, install({ quoteOwnerIds: [rep] }))).toBe(true);
    expect(salesBookedOrAssigned(rep, install({ quoteCreatedByIds: [rep] }))).toBe(true);
    expect(salesBookedOrAssigned(rep, install({ leadAssigneeId: rep }))).toBe(true);
  });

  it("shows a job the salesperson is assigned to, including their own visit", () => {
    expect(salesBookedOrAssigned(rep, install({ assigneeIds: [rep] }))).toBe(true);
    expect(salesBookedOrAssigned(rep, install({ scheduleAgentIds: [rep] }))).toBe(true);
  });

  it("hides the same installation from a salesperson who did not book it and is not assigned", () => {
    expect(salesBookedOrAssigned(other, install({ createdBy: rep, quoteSalesEngineerIds: [rep] }))).toBe(false);
    expect(salesBookedOrAssigned(rep, install())).toBe(false);
    expect(salesBookedOrAssigned(null, install({ createdBy: rep }))).toBe(false);
  });

  it("does not treat a second login as the same person", () => {
    const hennie = install({ createdBy: admin, quoteSalesEngineerIds: [admin], customerAssignedRepId: admin });
    expect(salesBookedOrAssigned(rep, hennie)).toBe(false);
    expect(salesBookedOrAssigned(admin, hennie)).toBe(true);
  });
});

describe("jobTechLocationAllowed", () => {
  const claim = install({ createdBy: rep });
  it("allows the salesperson who booked it, and a company admin", () => {
    expect(jobTechLocationAllowed({ userId: rep, admin: false, salesRep: true }, claim)).toBe(true);
    expect(jobTechLocationAllowed({ userId: admin, admin: true, salesRep: false }, install())).toBe(true);
  });
  it("refuses another salesperson and the technician", () => {
    expect(jobTechLocationAllowed({ userId: other, admin: false, salesRep: true }, install({ createdBy: rep, quoteSalesEngineerIds: [rep] }))).toBe(false);
    expect(jobTechLocationAllowed({ userId: tech, admin: false, salesRep: false }, install({ assigneeIds: [tech] }))).toBe(false);
  });
});

describe("schedule scope and unassigned own jobs", () => {
  it("reads only id arrays from the RPC payload", () => {
    const scope = scopeFromRpc({ job_ids: ["j1", 3], lead_ids: ["l1"] });
    expect([...scope.jobIds]).toEqual(["j1"]);
    expect([...scope.leadIds]).toEqual(["l1"]);
    expect(scopeFromRpc(null).jobIds.size).toBe(0);
  });
  it("keeps a booked job that has no technician on a row of its own", () => {
    const held = attachOwnUnassigned(
      [],
      [{ id: "j1", personId: null }],
      { id: "__mine_unassigned" },
    );
    expect(held.people.map((p) => p.id)).toEqual(["__mine_unassigned"]);
    expect(held.blocks[0].personId).toBe("__mine_unassigned");
    expect(attachOwnUnassigned([{ id: "t" }], [{ id: "j", personId: "t" }], { id: "__mine_unassigned" }).people.map((p) => p.id)).toEqual(["t"]);
  });
});

describe("SQL matches the booked-or-assigned rule", () => {
  const sql = readFileSync("supabase/migrations/20261106120000_sales_sees_booked_jobs.sql", "utf8");
  it("names the real fields and does not link the two logins or open the fleet map", () => {
    for (const field of [
      "j.created_by", "a.assigned_by", "a.profile_id", "s.agent_id",
      "q.sales_engineer_id", "q.owner_id", "q.created_by",
      "l.assigned_agent_id", "l.created_by", "g.assigned_by",
      "c.assigned_rep_id", "c.owner_rep_id",
    ]) expect(sql).toContain(field);
    expect(sql).not.toContain("rep_linked_admin");
    expect(sql).not.toMatch(/ON public\.agent_locations|FROM public\.agent_locations/);
    expect(sql).toContain("fl_is_company_admin");
    expect(sql).toContain("public.is_sales_rep(_uid) AND public.rep_booked_or_assigned_job");
    expect(sql).not.toContain("00000000-0000-0000-0000-000000000000");
  });
  it("keeps the office map and the sales rep's own location pin behind their existing gates", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).toMatch(/path="map" element=\{<RequireRole allowedRoles=\{\["admin","dispatcher","viewer","field_agent"\]\} denySalesRep>/);
    expect(app).toMatch(/path="jobs-map" element=\{<RequireRole allowedRoles=\{\["admin","dispatcher","viewer","field_agent"\]\} denySalesRep>/);
    expect(readFileSync("src/components/admin/NewAdminHeader.tsx", "utf8")).toContain("<LocationShareButton />");
    const calm = readFileSync("src/components/jobs/calm/JobsCalm.tsx", "utf8");
    expect(calm).toContain('supabase.rpc("sales_schedule_scope"');
    expect(calm).not.toMatch(/if \(salesOnly\) \{ people = people\.filter\(\(p\) => p\.lane === "sales"\)/);
    expect(calm).toContain("onMoveBlock={salesOnly ? undefined");
    expect(calm).toContain("unassigned={salesOnly ? []");
  });
});
