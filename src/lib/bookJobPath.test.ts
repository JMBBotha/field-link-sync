import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  applyCorrection, canLogPastWork, defaultCompleted, firstFitDoneFromVisits, firstFitInStep, houseAttachPlan,
  installationJobForHouse, installationJobInsert, johannesburgToday, pastDateAllowed, planPastSave, runPastSave,
  titleDefault, withFirstFit, workCards, type VisitRecord,
} from "./bookJobPath";

const house = { id: "h12", house_no: "12" };
const install = { id: "j1", title: "Installation — Avec House 12", customer_id: "c", job_type: "installation", quote_id: null, lead_id: "L1" };
const today = "2026-11-08";

describe("Book a job path", () => {
  it("attaches a project house to the existing installation job", () => {
    const plan = houseAttachPlan(house, [install, { id: "j2", title: "Service House 12", customer_id: "c", job_type: "service", lead_id: null }], "c");
    expect(plan.attached).toBe(true);
    expect(plan.job?.id).toBe("j1");
    expect(plan.createInstallationJob).toBe(false);
    expect(plan.createSecondJob).toBe(false);
    expect(plan.newSale).toBe(false);
    expect(plan.callOut).toBe(false);
  });

  it("does not treat a service call-out as the house installation", () => {
    expect(installationJobForHouse(house, [{ id: "s", title: "Service House 12", customer_id: "c", job_type: "service", lead_id: null }], "c")).toBeNull();
  });

  it("logs today or earlier as one visit and refuses a future date", () => {
    const ok = planPastSave({ doing: "past", visitKind: "first_fix", existingJobId: "j1", completed: false, date: today, today, role: { isAdmin: true } });
    expect(pastDateAllowed(today, today)).toBe(true);
    expect(pastDateAllowed("2026-11-03", today)).toBe(true);
    expect(ok.ok).toBe(true);
    expect(ok.writes).toBe(1);
    const future = planPastSave({ ...{ doing: "past" as const, visitKind: "first_fix" as const, existingJobId: "j1", completed: false, date: "2026-11-09", today, role: { isAdmin: true } } });
    expect(future.ok).toBe(false);
    expect(future.writes).toBe(0);
    expect(future.reason).toBe("date");
  });

  it("keeps first fix off the new-quote and new call-out paths", () => {
    expect(workCards("past", false)).toBe("visit");
    expect(workCards("upcoming", true)).toBe("visit");
    expect(workCards("upcoming", false)).toBe("new_sale");
    const plan = planPastSave({ doing: "past", visitKind: "first_fix", existingJobId: null, completed: false, date: "2026-11-03", today, role: { isAdmin: true } });
    expect(plan.path).toBe("visit_on_installation");
    expect(plan.jobType).toBe("installation");
    expect(plan.newSale).toBe(false);
    expect(plan.callOut).toBe(false);
    expect(plan.quoteId).toBeNull();
    expect(plan.rpc).toBe("admin_backfill_visit");
  });

  it("leaves whole job finished off by default on a first fix", () => {
    expect(defaultCompleted("first_fix")).toBe(false);
    const plan = planPastSave({ doing: "past", visitKind: "first_fix", existingJobId: "j1", completed: defaultCompleted("first_fix"), date: "2026-11-03", today, role: { isAdmin: true } });
    expect(plan.completed).toBe(false);
    expect(plan.markFirstFit).toBe(true);
  });

  it("does not message the client or alert reps, and sales cannot log", async () => {
    const plan = planPastSave({ doing: "past", visitKind: "first_fix", existingJobId: "j1", completed: false, date: "2026-11-03", today, role: { isAdmin: true } });
    expect(plan.messageClient).toBe(false);
    expect(plan.alertReps).toBe(false);
    expect(canLogPastWork(false)).toBe(false);
    const sales = planPastSave({ doing: "past", visitKind: "first_fix", existingJobId: "j1", completed: false, date: "2026-11-03", today, role: { isAdmin: false } });
    expect(sales.ok).toBe(false);
    expect(sales.reason).toBe("admin_only");
    const calls: string[] = [];
    await runPastSave(plan, "j1", {
      createJob: async () => { throw new Error("second job"); },
      backfill: async () => { calls.push("visit"); return "e1"; },
      correct: async () => { throw new Error("copy"); },
      syncFirstFit: async () => { calls.push("fit"); },
      firstFitDone: true,
      notifyClient: async () => { calls.push("client"); },
      alertReps: async () => { calls.push("reps"); },
    });
    expect(calls).toEqual(["visit", "fit"]);
  });

  it("creates an installation job when the house has none", () => {
    const plan = houseAttachPlan({ id: "h9", house_no: "9" }, [], "c");
    expect(plan.createInstallationJob).toBe(true);
    expect(plan.newSale).toBe(false);
    const row = installationJobInsert({ companyId: "co-ct", customerId: "c", title: titleDefault("Avec", "9", "first_fix"), description: "Avec House 9", address: "Avec House 9", userId: "u" });
    expect(row.company_id).toBe("co-ct");
    expect(row.job_type).toBe("installation");
    expect(row.quote_id).toBeNull();
    expect(row.call_out_excl_vat).toBeNull();
    expect(row.title).toBe("First fix — Avec House 9");
    const save = planPastSave({ doing: "past", visitKind: "first_fix", existingJobId: null, completed: false, date: "2026-11-01", today, role: { isAdmin: true } });
    expect(save.createInstallationJob).toBe(true);
    expect(save.path).not.toBe("new_quote");
  });

  it("corrects the same visit record", async () => {
    const visit: VisitRecord = { id: "e1", jobId: "j1", techId: "t1", techName: "Tech A", date: "2026-11-03", arrive: "08:00", leave: "10:00", note: "First fix", completed: false, kind: "first_fix" };
    const next = applyCorrection(visit, { note: "First fix sleeves", arrive: "08:30", techId: "t2" });
    expect(next.id).toBe(visit.id);
    expect(next.jobId).toBe("j1");
    expect(next.note).toBe("First fix sleeves");
    const plan = planPastSave({ doing: "correct", visitKind: "first_fix", existingJobId: "j1", completed: false, date: "2026-11-03", today, role: { isAdmin: true }, visitId: "e1" });
    expect(plan.rpc).toBe("admin_correct_visit");
    expect(plan.sameVisitId).toBe("e1");
    const out = await runPastSave(plan, "j1", {
      createJob: async () => { throw new Error("no"); },
      backfill: async () => { throw new Error("copy"); },
      correct: async (id) => id,
      firstFitDone: true,
    });
    expect(out.entryId).toBe("e1");
  });

  it("keeps First fit in step with the saved visit", () => {
    const steps = [{ step_key: "first_fit", done: false }, { step_key: "piping", done: false }];
    const after = withFirstFit(steps, [{ kind: "first_fix" as const }]);
    expect(after.find((s) => s.step_key === "first_fit")?.done).toBe(true);
    expect(firstFitInStep(after, [{ kind: "first_fix" }])).toBe(true);
    expect(firstFitDoneFromVisits([{ kind: "first_fix" }])).toBe(true);
    const cleared = withFirstFit(after, [{ kind: "later_install" as const }]);
    expect(cleared.find((s) => s.step_key === "first_fit")?.done).toBe(false);
    expect(firstFitInStep(cleared, [{ kind: "later_install" }])).toBe(true);
  });

  it("keeps the quiet admin backfill in SQL", () => {
    const sql = readFileSync("supabase/migrations/20261108103000_book_job_past_visit.sql", "utf8");
    expect(sql).toContain("app.backfill");
    expect(sql).toContain("_backfill_ctx");
    expect(sql).toContain("fl_is_company_admin");
    expect(sql).toContain("WHERE id = e.id");
    expect(sql).toContain("same_record");
    expect(sql).not.toContain("send_booking_confirmation");
    expect(sql).not.toContain("INSERT INTO public.notifications");
    expect(johannesburgToday(new Date("2026-11-08T12:00:00+02:00"))).toBe("2026-11-08");
  });
});
