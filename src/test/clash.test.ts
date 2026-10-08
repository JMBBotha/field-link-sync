import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { overlaps, isTight, isAfterHours, findClashes, overlapMap } from "@/lib/clash";
import { hhmm, leadMinutes, defaultMinutes, jobMinutes, intervalToMinutes, sastParts } from "@/lib/schedulingDefaults";
import { buildCalendarEntries, summarizeDay } from "@/lib/todaysJobs";

describe("clash maths", () => {
  it("overlap detected", () => {
    expect(overlaps({ start: "10:00", end: "11:30" }, { start: "11:00", end: "12:00" })).toBe(true);
  });
  it("touching edges are not a clash", () => {
    expect(overlaps({ start: "10:00", end: "11:00" }, { start: "11:00", end: "12:00" })).toBe(false);
    expect(isTight({ start: "10:00", end: "11:00" }, { start: "11:00", end: "12:00" })).toBe(true);
  });
  it("tight under 30 min, not at 30", () => {
    expect(isTight({ start: "13:00", end: "14:00" }, { start: "12:00", end: "12:45" })).toBe(true);
    expect(isTight({ start: "13:00", end: "14:00" }, { start: "12:00", end: "12:30" })).toBe(false);
  });
  it("self excluded", () => {
    const bookings = [{ id: "s1", start: "09:00", end: "10:00", job_id: "j1", label: "A" }, { id: "s2", start: "09:30", end: "10:30", lead_id: "l2", label: "B" }];
    const rows = findClashes({ start: "09:00", end: "10:00" }, bookings, { job_id: "j1" });
    expect(rows).toEqual([expect.objectContaining({ kind: "overlap", label: "B" })]);
    expect(findClashes({ start: "09:00", end: "10:00" }, bookings, { job_id: "j1", lead_id: "l2" })).toHaveLength(0);
  });
  it("after hours: evenings and weekends", () => {
    expect(isAfterHours("2026-10-08", { start: "08:00", end: "17:00" })).toBe(false); // Thu
    expect(isAfterHours("2026-10-08", { start: "16:30", end: "17:30" })).toBe(true);
    expect(isAfterHours("2026-10-08", { start: "07:30", end: "09:00" })).toBe(true);
    expect(isAfterHours("2026-10-10", { start: "09:00", end: "10:00" })).toBe(true); // Sat
  });
  it("overlapMap pairs same person + day only", () => {
    const m = overlapMap([
      { id: "a", agent_id: "p1", scheduled_date: "2026-10-08", start_time: "09:00", end_time: "10:00" },
      { id: "b", agent_id: "p1", scheduled_date: "2026-10-08", start_time: "09:30", end_time: "10:30" },
      { id: "c", agent_id: "p2", scheduled_date: "2026-10-08", start_time: "09:30", end_time: "10:30" },
    ]);
    expect(m.get("a")?.id).toBe("b");
    expect(m.get("b")?.id).toBe("a");
    expect(m.has("c")).toBe(false);
  });
});

describe("scheduling defaults", () => {
  it("hhmm trims seconds and pads", () => {
    expect(hhmm("14:00:00")).toBe("14:00");
    expect(hhmm("9:5")).toBe("09:05");
    expect(hhmm(null)).toBe("");
  });
  it("lengths", () => {
    expect(leadMinutes({ primary_intent: "sales" })).toBe(60);
    expect(leadMinutes({ estimated_duration_minutes: 90 })).toBe(90);
    expect(defaultMinutes("installation", 2)).toBe(420);
    expect(defaultMinutes("repair")).toBe(150);
    expect(defaultMinutes("service")).toBe(120);
    expect(jobMinutes({ estimated_duration: "04:00:00", job_type: "installation" })).toBe(240);
    expect(intervalToMinutes("2.5 hours")).toBe(150);
  });
  it("sastParts is UTC+2", () => {
    expect(sastParts("2026-10-08T12:00:00Z")).toEqual({ date: "2026-10-08", time: "14:00" });
  });
});

describe("todaysJobs dedupe + cancelled", () => {
  const D = "2026-10-08";
  const row = (o: any) => ({ id: o.id, lead_id: o.lead_id, job_id: o.job_id ?? null, agent_id: o.agent ?? "a1",
    scheduled_date: o.date ?? D, start_time: "09:00", leads: { status: o.ls ?? "accepted", customer_name: "C" }, jobs: o.js ? { status: o.js } : null });
  it("skips made-up lead tile when a job row has same lead, person and date", () => {
    const e = buildCalendarEntries([row({ id: "s1", lead_id: "l1", job_id: "j1" })],
      [{ id: "l1", assigned_agent_id: "a1", scheduled_date: D, status: "accepted" }]);
    expect(e).toHaveLength(1);
    expect(e[0].job_id).toBe("j1");
  });
  it("keeps separate tiles when person or date differs", () => {
    const e = buildCalendarEntries([row({ id: "s1", lead_id: "l1", job_id: "j1", agent: "tech" })],
      [{ id: "l1", assigned_agent_id: "a1", scheduled_date: D, status: "accepted" }]);
    expect(e).toHaveLength(2);
  });
  it("hides cancelled jobs and leads", () => {
    const e = buildCalendarEntries([
      row({ id: "s1", lead_id: "l1", job_id: "j1", js: "cancelled" }),
      row({ id: "s2", lead_id: "l2", ls: "canceled" }),
      row({ id: "s3", lead_id: "l3" }),
    ], [{ id: "l4", assigned_agent_id: "a1", scheduled_date: D, status: "cancelled" }]);
    expect(e.map((x) => x.lead_id)).toEqual(["l3"]);
    expect(summarizeDay(e, D).total).toBe(1);
  });
});
