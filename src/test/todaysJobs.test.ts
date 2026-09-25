import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { todayInJohannesburg, buildCalendarEntries, summarizeDay, overdueEntries } from "@/lib/todaysJobs";

const sched = (o: any) => ({ id: o.id, lead_id: o.lead_id ?? null, job_id: o.job_id ?? null, agent_id: "a1",
  scheduled_date: o.date, start_time: o.t ?? "09:00", leads: { status: o.ls ?? "accepted", customer_name: "C" }, jobs: o.js ? { status: o.js } : null });

describe("todayInJohannesburg", () => {
  it("23:30 UTC is next day in SAST", () => {
    expect(todayInJohannesburg(new Date("2026-09-25T23:30:00Z"))).toBe("2026-09-26");
  });
  it("00:30 SAST (22:30 UTC prev day) is SAST date", () => {
    expect(todayInJohannesburg(new Date("2026-09-25T22:30:00Z"))).toBe("2026-09-26");
    expect(todayInJohannesburg(new Date("2026-09-25T21:30:00Z"))).toBe("2026-09-25");
  });
});

describe("calendar entries", () => {
  const D = "2026-09-26";
  it("leads without person+date never count", () => {
    const e = buildCalendarEntries([], [
      { id: "l1", assigned_agent_id: null, scheduled_date: D, status: "accepted" },
      { id: "l2", assigned_agent_id: "a1", scheduled_date: null, status: "accepted" },
    ]);
    expect(summarizeDay(e, D).open).toHaveLength(0);
  });
  it("excludes cancelled and completed, counts completed", () => {
    const e = buildCalendarEntries([
      sched({ id: "s1", lead_id: "l1", date: D }),
      sched({ id: "s2", lead_id: "l2", date: D, ls: "cancelled" }),
      sched({ id: "s3", lead_id: "l3", job_id: "j3", date: D, js: "completed" }),
    ], []);
    const s = summarizeDay(e, D);
    expect(s.open.map((x) => x.lead_id)).toEqual(["l1"]);
    expect(s.completed).toBe(1);
    expect(s.total).toBe(2);
  });
  it("de-duplicates by job_id / lead_id and schedule row beats synthesized lead", () => {
    const e = buildCalendarEntries([
      sched({ id: "s1", lead_id: "l1", date: D }),
      sched({ id: "s1b", lead_id: "l1", date: D }),
      sched({ id: "s2", lead_id: "l1", job_id: "j9", date: D }),
      sched({ id: "s3", lead_id: "l1", job_id: "j9", date: D }),
    ], [{ id: "l1", assigned_agent_id: "a1", scheduled_date: D, status: "accepted" }]);
    expect(e).toHaveLength(2);
  });
  it("overdue: before today and not closed", () => {
    const e = buildCalendarEntries([
      sched({ id: "s1", lead_id: "l1", date: "2026-06-01" }),
      sched({ id: "s2", lead_id: "l2", date: "2026-06-01", ls: "completed" }),
      sched({ id: "s3", lead_id: "l3", date: D }),
    ], [{ id: "l4", assigned_agent_id: "a1", scheduled_date: "2026-08-01", status: "accepted" }]);
    expect(overdueEntries(e, D).map((x) => x.lead_id).sort()).toEqual(["l1", "l4"]);
  });
});
