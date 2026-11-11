import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SalesTechChecklist } from "@/components/team/SalesTechChecklist";
import { bookableForCaller, isSalespersonProfile, memberRoleBadge, NO_TECHS_ASSIGNED } from "@/lib/salesTechAccess";

const root = resolve(__dirname, "../..");
const migration = readFileSync(resolve(root, "supabase/migrations/20261111180000_sales_rep_technicians.sql"), "utf8");
const rollback = readFileSync(resolve(root, "supabase/manual/20261111180000_sales_rep_technicians_rollback.sql"), "utf8");
const previousDispatch = readFileSync(resolve(root, "supabase/migrations/20261111153000_no_login_technicians.sql"), "utf8");
const previousRank = readFileSync(resolve(root, "drizzle/migrations/0005_calendar_s5_rank_busy_fix.sql"), "utf8");
const previousLead = readFileSync(resolve(root, "supabase/migrations/20261029143000_sales_assign_lead.sql"), "utf8");

function grab(src: string, name: string) {
  const start = src.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  if (start < 0) throw new Error(`missing ${name}`);
  const asAt = src.indexOf("AS ", start);
  const tagAt = src.indexOf("$", asAt);
  const tagEnd = src.indexOf("$", tagAt + 1);
  const tag = src.slice(tagAt, tagEnd + 1);
  const close = src.indexOf(`${tag};`, tagEnd + 1);
  if (close < 0) throw new Error(`no close for ${name}`);
  return src.slice(start, close + tag.length + 1);
}

describe("sales rep technician assignment", () => {
  it("lets office book anyone and a salesperson only their assigned technicians", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(bookableForCaller(rows, false, ["a"]).map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(bookableForCaller(rows, true, ["b", "c"]).map((r) => r.id)).toEqual(["b", "c"]);
    expect(bookableForCaller(rows, true, [])).toEqual([]);
    expect(bookableForCaller(rows, true, null)).toEqual([]);
    expect(isSalespersonProfile({ dispatch_role: "sales", participant_type: "company_staff" })).toBe(true);
    expect(isSalespersonProfile({ dispatch_role: "sales_engineer", participant_type: null })).toBe(true);
    expect(isSalespersonProfile({ dispatch_role: "sales", participant_type: "independent_tech" })).toBe(false);
    expect(isSalespersonProfile({ dispatch_role: "technician", participant_type: "company_staff" })).toBe(false);
    expect(memberRoleBadge("dispatcher", ["dispatcher"], "sales", "Dispatcher")).toBe("Salesperson");
    expect(memberRoleBadge("dispatcher", ["dispatcher"], "sales_engineer", "Dispatcher")).toBe("Salesperson");
    expect(memberRoleBadge("dispatcher", ["admin", "dispatcher"], "sales", "Dispatcher")).toBe("Dispatcher");
    expect(memberRoleBadge("dispatcher", ["dispatcher"], "technician", "Dispatcher")).toBe("Dispatcher");
    expect(memberRoleBadge("field_agent", ["dispatcher", "field_agent"], "sales", "Technician")).toBe("Technician");
  });

  it("defines sales_may_book_tech as true for non-sales and an assignment row for sales", () => {
    const fn = grab(migration, "sales_may_book_tech");
    expect(fn).toContain("SECURITY DEFINER");
    expect(fn).toContain("WHEN _uid IS NULL OR NOT public.is_sales_rep(_uid) THEN true");
    expect(fn).toContain("s.sales_rep_id = _uid");
    expect(fn).toContain("s.technician_id = _tech");
    expect(fn).toContain("s.company_id = public.get_user_company_id(_uid)");
  });

  it("filters the three list RPCs and rejects a sales booking of someone else", () => {
    const dispatch = grab(migration, "dispatchable_technicians");
    expect(dispatch).toContain("OR NOT public.is_sales_rep(auth.uid())");
    expect(dispatch).toContain("OR public.sales_may_book_tech(auth.uid(), t.id)");
    const strippedDispatch = dispatch.replace(
      `\n    AND (\n      auth.uid() IS NULL\n      OR NOT public.is_sales_rep(auth.uid())\n      OR public.sales_may_book_tech(auth.uid(), t.id)\n    )`,
      "",
    );
    expect(strippedDispatch).toBe(grab(previousDispatch, "dispatchable_technicians"));

    const rank = grab(migration, "_rank_core");
    expect(rank).toContain("public.is_sales_rep(v_uid) AND p_lane IS DISTINCT FROM 'sales' AND public.sales_may_book_tech(v_uid, pr.id)");
    const strippedRank = rank.replace(
      `      AND (\n        v_full\n        OR pr.id = v_uid\n        OR (public.is_sales_rep(v_uid) AND p_lane IS DISTINCT FROM 'sales' AND public.sales_may_book_tech(v_uid, pr.id))\n      )\n`,
      "      AND (v_full OR pr.id = v_uid)\n",
    );
    expect(strippedRank).toBe(grab(previousRank, "_rank_core"));

    const options = grab(migration, "lead_assign_options");
    expect(options).toContain("AND (NOT v_sales OR public.sales_may_book_tech(v_uid, p.id))");
    const strippedOptions = options.replace(
      "\n           AND (NOT v_sales OR public.sales_may_book_tech(v_uid, p.id))",
      "",
    );
    expect(strippedOptions).toBe(grab(previousLead, "lead_assign_options"));

    const assign = grab(migration, "assign_lead_to_tech");
    expect(assign).toContain("IF v_sales AND NOT public.sales_may_book_tech(v_uid, p_tech_id) THEN");
    expect(assign).toContain("'That technician is not assigned to you'");
    const strippedAssign = assign.replace(
      `  IF v_sales AND NOT public.sales_may_book_tech(v_uid, p_tech_id) THEN\n    RETURN jsonb_build_object('ok', false, 'code', 403, 'message', 'That technician is not assigned to you');\n  END IF;\n`,
      "",
    );
    expect(strippedAssign).toBe(grab(previousLead, "assign_lead_to_tech"));

    const request = grab(migration, "request_lead_reassignment");
    expect(request).toContain("IF p_preferred_tech_id IS NOT NULL AND public.is_sales_rep(v_uid) AND NOT public.sales_may_book_tech(v_uid, p_preferred_tech_id) THEN");
    const strippedRequest = request.replace(
      `  IF p_preferred_tech_id IS NOT NULL AND public.is_sales_rep(v_uid) AND NOT public.sales_may_book_tech(v_uid, p_preferred_tech_id) THEN\n    RETURN jsonb_build_object('ok', false, 'code', 403, 'message', 'That technician is not assigned to you');\n  END IF;\n`,
      "",
    );
    expect(strippedRequest).toBe(grab(previousLead, "request_lead_reassignment"));
  });

  it("adds a restrictive profile read for sales and does not loosen schedule writes or locations", () => {
    expect(migration).toContain("CREATE POLICY srt_sales_profiles_select ON public.profiles");
    expect(migration).toContain("AS RESTRICTIVE FOR SELECT TO authenticated");
    expect(migration).toContain("USING (public.sales_profile_visible(id))");
    const visible = grab(migration, "sales_profile_visible");
    expect(visible).toContain("_profile = auth.uid()");
    expect(visible).toContain("public.sales_may_book_tech(auth.uid(), _profile)");
    expect(visible).toContain("public.rep_booked_or_assigned_job(auth.uid(), a.job_id)");
    expect(visible).toContain("public.rep_booked_or_assigned_lead(auth.uid(), l.id)");
    expect(visible).toContain("NOT IN ('declined', 'cancelled', 'rejected')");

    expect(migration).toContain("CREATE POLICY srt_sales_sched_select ON public.job_schedules");
    expect(migration).toContain("USING (public.sales_schedule_row_visible(agent_id, job_id, lead_id))");
    const slots = grab(migration, "sales_schedule_row_visible");
    expect(slots).toContain("_agent IS NOT DISTINCT FROM auth.uid()");
    expect(slots).toContain("public.sales_may_book_tech(auth.uid(), _agent)");
    expect(slots).toContain("public.rep_booked_or_assigned_job(auth.uid(), _job)");
    expect(slots).toContain("public.rep_booked_or_assigned_lead(auth.uid(), _lead)");

    expect(migration).toContain("CREATE POLICY srt_rep_select");
    expect(migration).toContain("CREATE POLICY srt_admin_select");
    expect(migration).toContain("CREATE POLICY srt_admin_insert");
    expect(migration).toContain("CREATE POLICY srt_admin_delete");
    expect(migration).toContain("public.fl_is_company_admin(auth.uid(), company_id)");
    expect(migration).not.toMatch(/DROP POLICY IF EXISTS dl_rep_/);
    expect(migration).not.toMatch(/CREATE POLICY .* ON public\.agent_locations/);
    expect(migration).not.toContain("CREATE OR REPLACE FUNCTION public.job_tech_location");
    expect(migration).toContain("p.dispatch_role = 'technician'");
    expect(migration).toContain("p.participant_type = 'independent_tech'");
    expect(migration).not.toMatch(/AND NOT coalesce\(p\.no_login/);
  });

  it("seeds Johan Sales onto current Massair CT service-lane technicians and leaves Almari empty", () => {
    expect(migration).toContain("'420c7731-e8a4-4355-80ca-51c684b42a2c'::uuid");
    expect(migration).toContain("'361bf031-9cdb-4d7f-9bde-9eb95fa4725e'::uuid");
    expect(migration).toContain("09a7f5af-2752-4835-8738-54f7b53083ea");
    expect(migration).not.toContain("'f7503c66");
    expect(migration).toContain("ON CONFLICT DO NOTHING");
    expect(migration).toContain("No automatic row when a technician is added");
  });

  it("rollback restores the previous RPC bodies and drops the new table", () => {
    expect(grab(rollback, "dispatchable_technicians")).toBe(grab(previousDispatch, "dispatchable_technicians"));
    expect(grab(rollback, "_rank_core")).toBe(grab(previousRank, "_rank_core"));
    expect(grab(rollback, "lead_assign_options")).toBe(grab(previousLead, "lead_assign_options"));
    expect(grab(rollback, "assign_lead_to_tech")).toBe(grab(previousLead, "assign_lead_to_tech"));
    expect(grab(rollback, "request_lead_reassignment")).toBe(grab(previousLead, "request_lead_reassignment"));
    expect(rollback).toContain("DROP POLICY IF EXISTS srt_sales_profiles_select ON public.profiles");
    expect(rollback).toContain("DROP POLICY IF EXISTS srt_sales_sched_select ON public.job_schedules");
    expect(rollback).toContain("DROP TABLE IF EXISTS public.sales_rep_technicians");
    expect(rollback).toContain("DROP FUNCTION IF EXISTS public.sales_may_book_tech(uuid, uuid)");
    expect(rollback).not.toContain("That technician is not assigned to you");
  });

  it("checks the helper, RPC filters, and profile visibility in memory", () => {
    const out = execFileSync(process.execPath, ["supabase/tests/sales_rep_technicians/run.mjs"], {
      cwd: root,
      encoding: "utf8",
      timeout: 60000,
    });
    expect(out).toContain("ALL OK");
    expect(out).not.toContain("FAIL");
  }, 60000);

  it("shows the team checklist with the shared sliding switch", () => {
    const toggled: Array<[string, boolean]> = [];
    render(
      <SalesTechChecklist
        techs={[{ id: "a", name: "Tech A" }, { id: "b", name: "Tech B", noLogin: true }]}
        assignedIds={["a"]}
        onToggle={(id, on) => toggled.push([id, on])}
      />,
    );
    expect(screen.getByText("Technicians they can book")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Technicians they can book: Tech A" })).toHaveAttribute("data-state", "checked");
    expect(screen.getByRole("switch", { name: "Technicians they can book: Tech B" })).toHaveAttribute("data-state", "unchecked");
    fireEvent.click(screen.getByRole("switch", { name: "Technicians they can book: Tech B" }));
    expect(toggled).toEqual([["b", true]]);
  });

  it("uses the sales empty sentence in the booking surfaces", () => {
    const read = (p: string) => readFileSync(resolve(root, p), "utf8");
    for (const file of [
      "src/components/scheduling/AppointmentPicker.tsx",
      "src/components/jobs/AssignTechDialog.tsx",
      "src/components/jobs/LeadAssignDialog.tsx",
      "src/components/jobs/CreateJobDialog.tsx",
      "src/pages/SalesTechHarness.tsx",
    ]) {
      expect(read(file), file).toContain("NO_TECHS_ASSIGNED");
    }
    expect(NO_TECHS_ASSIGNED).toBe("No technicians assigned to you yet — ask an admin.");
    expect(read("src/hooks/useLaneStaff.ts")).toContain("bookableForCaller");
    expect(read("src/hooks/useBookingTechnicians.ts")).toContain("salesRep: true");
    expect(read("src/pages/admin/AdminTeamPage.tsx")).toContain("SalesTechChecklist");
    expect(read("src/pages/admin/AdminTeamPage.tsx")).toContain("memberRoleBadge");
    expect(read("src/components/settings/AgentManagementTab.tsx")).toContain("memberRoleBadge");
    expect(read("src/pages/admin/AdminTeamPage.tsx")).toContain('style={{ background: "#C2410C" }}');
  });
});
