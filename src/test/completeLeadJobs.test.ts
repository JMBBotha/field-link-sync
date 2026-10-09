import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// Q3 (2026-10-09): completing a job from the lead sheet left the jobs row open (no jobId passed;
// jobs update only ran with a jobId and ignored errors).
const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
let selectResult: { data: unknown; error: unknown } = { data: [], error: null };
let updateResult: { data: unknown; error: unknown } = { data: null, error: null };

function builder(table: string) {
  let mode = "select";
  const b: any = {};
  for (const m of ["select", "update", "eq", "in", "order"]) {
    b[m] = (...args: unknown[]) => {
      if (m === "update") mode = "update";
      calls.push({ table, op: m, args });
      return b;
    };
  }
  b.then = (res: (v: unknown) => unknown) => res(mode === "update" ? updateResult : selectResult);
  return b;
}
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => builder(t) } }));

import { completeJobsForLead, findOpenJobIdsForLead, OPEN_JOB_STATUSES } from "@/lib/completeLeadJobs";

describe("completeJobsForLead", () => {
  beforeEach(() => {
    calls.length = 0;
    selectResult = { data: [], error: null };
    updateResult = { data: null, error: null };
  });

  it("looks up the lead's open jobs when no jobId is given and completes them", async () => {
    selectResult = { data: [{ id: "job-1" }, { id: "job-2" }], error: null };
    await completeJobsForLead("lead-1");
    expect(calls).toContainEqual({ table: "jobs", op: "eq", args: ["lead_id", "lead-1"] });
    expect(calls).toContainEqual({ table: "jobs", op: "update", args: [{ status: "completed" }] });
    expect(calls).toContainEqual({ table: "jobs", op: "in", args: ["id", ["job-1", "job-2"]] });
    expect(calls).toContainEqual({ table: "jobs", op: "in", args: ["status", [...OPEN_JOB_STATUSES]] });
  });

  it("uses the given jobId without a lookup", async () => {
    await completeJobsForLead("lead-1", "job-9");
    expect(calls.some((c) => c.op === "eq")).toBe(false);
    expect(calls).toContainEqual({ table: "jobs", op: "in", args: ["id", ["job-9"]] });
  });

  it("does nothing when the lead has no open job", async () => {
    await completeJobsForLead("lead-1");
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });

  it("surfaces update errors instead of ignoring them", async () => {
    updateResult = { data: null, error: { message: "denied" } };
    await expect(completeJobsForLead("lead-1", "job-9")).rejects.toEqual({ message: "denied" });
  });

  it("findOpenJobIdsForLead returns newest-first ids", async () => {
    selectResult = { data: [{ id: "b" }, { id: "a" }], error: null };
    expect(await findOpenJobIdsForLead("lead-1")).toEqual(["b", "a"]);
  });
});

describe("completion flows use the helper", () => {
  const src = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");
  it("online save, offline sync and the sheet all route through completeLeadJobs", () => {
    expect(src("hooks/useJobCompletion.ts")).toContain("await completeJobsForLead(input.leadId, input.jobId)");
    expect(src("hooks/useSyncQueue.ts")).toContain("await completeJobsForLead(operation.recordId");
    const sheet = src("components/jobs/JobCompletionSheet.tsx");
    expect(sheet).toContain("jobId: effectiveJobId");
    // Extras/extra time now go server-side with the invoice request (which also writes job_overruns).
    expect(sheet).toContain("p_job_id: effectiveJobId");
  });
});
