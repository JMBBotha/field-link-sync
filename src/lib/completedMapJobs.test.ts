import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { completedMapCards, isGenuinelyCompletedJobStatus, withCompletedJobCount, type CompletedMapJob } from "./completedMapJobs";

const CT = "company-ct";
const hennie = (): CompletedMapJob => ({
  id: "af49ca54-job",
  company_id: CT,
  status: "scheduled",
  title: "Installation",
  job_type: "installation",
  completed_at: null,
  address: "19 Amandel Close, Bellville",
  lead: {
    id: "0a0c1c34-lead",
    customer_name: "Hennie Matthee",
    customer_phone: "+27628900808",
    customer_address: "19 Amandel Close, Bellville, Western Cape",
    service_type: "installation",
    company_id: CT,
    latitude: -33.9,
    longitude: 18.6,
  },
  assignee_ids: ["09a7f5af-innocent"],
  completion: null,
});

const marina = (): CompletedMapJob => ({
  id: "marina-job",
  company_id: CT,
  status: "completed",
  title: "Installation",
  completed_at: "2026-11-01T08:00:00+02:00",
  address: "1 Marina Road",
  lead: {
    id: "marina-lead",
    customer_name: "Marina",
    service_type: "installation",
    company_id: CT,
    customer_phone: "0210000000",
    customer_address: "1 Marina Road, Cape Town",
    latitude: -33.9,
    longitude: 18.4,
  },
  assignee_ids: ["someone-else"],
  completion: {
    status: "completed",
    completed_at: "2026-11-01T08:30:00+02:00",
    technician_id: "tech-marina",
    technician_name: "Completed Tech",
  },
});

const run = (jobs: CompletedMapJob[], techId?: string | null) =>
  completedMapCards({ jobs, companyId: CT, techId });

describe("finished job statuses", () => {
  it("treats completed, done, invoiced, closed and paid as finished, and not a reopen or a cancellation", () => {
    for (const s of ["completed", "done", "invoiced", "closed", "paid"]) expect(isGenuinelyCompletedJobStatus(s)).toBe(true);
    for (const s of ["scheduled", "dispatched", "in_progress", "pending", "converted", "cancelled", "canceled", ""]) {
      expect(isGenuinelyCompletedJobStatus(s)).toBe(false);
    }
  });
});

describe("completed map jobs", () => {
  it("leaves out Hennie: converted lead, scheduled job, no completion", () => {
    const cards = run([hennie(), marina()]);
    expect(cards.map((c) => c.jobId)).toEqual(["marina-job"]);
    expect(cards.some((c) => c.name === "Hennie Matthee")).toBe(false);
  });

  it("includes a genuinely completed job and shows completion evidence, not the assignee", () => {
    const [card] = run([marina()]);
    expect(card.name).toBe("Marina");
    expect(card.completedBy).toBe("Completed Tech");
    expect(card.completedBy).not.toBe("someone-else");
    expect(card.completedAt).toBe("2026-11-01T08:00:00+02:00");
    expect(card.href).toBe("/admin/jobs/marina-job");
    expect(card.leadId).toBe("marina-lead");
    expect(card.lat).toBe(-33.9);
    expect(card.lng).toBe(18.4);
  });

  it("leaves out a reopened job even when an old completion row remains", () => {
    const reopened: CompletedMapJob = {
      ...marina(),
      id: "reopened-job",
      status: "in_progress",
      completed_at: "2026-10-01T08:00:00+02:00",
      lead: { ...marina().lead!, customer_name: "Reopened Client", id: "reopen-lead" },
    };
    expect(run([reopened, marina()]).map((c) => c.name)).toEqual(["Marina"]);
    const scheduledAgain: CompletedMapJob = { ...reopened, status: "scheduled" };
    expect(run([scheduledAgain]).map((c) => c.jobId)).toEqual([]);
  });

  it("leaves out deleted and merged leads, and other companies", () => {
    const deleted: CompletedMapJob = { ...marina(), id: "del-job", lead: { ...marina().lead!, deleted_at: "2026-11-02T00:00:00Z" } };
    const merged: CompletedMapJob = { ...marina(), id: "merge-job", lead: { ...marina().lead!, deleted_at: null, merged_into_id: "other-lead" } };
    const other: CompletedMapJob = { ...marina(), id: "other-co", company_id: "other-company" };
    expect(run([deleted, merged, other, marina()]).map((c) => c.jobId)).toEqual(["marina-job"]);
  });

  it("a tech does not see another company's or another tech's finished job", () => {
    const mine: CompletedMapJob = {
      ...marina(),
      id: "mine",
      assignee_ids: [],
      completion: { status: "completed", completed_at: "2026-11-02T09:00:00+02:00", technician_id: "09a7f5af-innocent", technician_name: "Innocent Mattienga" },
    };
    const cards = run([marina(), mine, { ...marina(), id: "foreign", company_id: "nope" }], "09a7f5af-innocent");
    expect(cards.map((c) => c.jobId)).toEqual(["mine"]);
    expect(cards[0].completedBy).toBe("Innocent Mattienga");
  });

  it("chip count matches the list", () => {
    const cards = run([hennie(), marina(), { ...marina(), id: "paid-job", status: "paid", completed_at: "2026-10-01T00:00:00Z", completion: null, lead: { ...marina().lead!, id: "paid-lead", customer_name: "Paid Client" } }]);
    const counts = withCompletedJobCount({ pending: 2, accepted: 0, in_progress: 0, completed: 6, cancelled: 4 }, cards.length);
    expect(counts.completed).toBe(cards.length);
    expect(counts.completed).toBe(2);
    expect(counts.pending).toBe(2);
    expect(cards.every((c) => c.href.startsWith("/admin/jobs/"))).toBe(true);
  });

  it("does not invent a completed-by name when there is no completion record", () => {
    const [card] = run([{ ...marina(), completion: null, assignee_ids: ["09a7f5af-innocent"] }]);
    expect(card.completedBy).toBeNull();
    expect(card.completedAt).toBe("2026-11-01T08:00:00+02:00");
  });
});
