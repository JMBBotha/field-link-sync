import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { buildBoardRows, groupBoardRows, rowTarget } from "@/lib/jobsBoard";
import { buildCalendarEntries } from "@/lib/todaysJobs";

const job = (id: string, status: string) => ({ id, status, title: id });

describe("jobs board grouping", () => {
  it("never drops unknown statuses — they land in Scheduled", () => {
    const rows = buildBoardRows([job("a", "pending"), job("b", "on_hold"), job("c", "new"), job("d", "dispatched")], []);
    const g = groupBoardRows(rows, false);
    expect(g.columns.scheduled.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(g.columns.dispatched.map((r) => r.id)).toEqual(["d"]);
    expect(g.visible).toBe(4);
  });
  it("hides cancelled unless toggled, but counts them", () => {
    const rows = buildBoardRows([job("a", "cancelled"), job("b", "canceled"), job("c", "completed")], []);
    const off = groupBoardRows(rows, false);
    expect(off.cancelled).toBe(2);
    expect(off.visible).toBe(1);
    const on = groupBoardRows(rows, true);
    expect(on.visible).toBe(3);
    expect(on.columns.scheduled).toHaveLength(2);
  });
  it("merges booked leads and de-dupes against jobs by job_id", () => {
    const entries = buildCalendarEntries(
      [{ id: "s1", lead_id: "l1", job_id: "j1", agent_id: "a", scheduled_date: "2026-09-28", start_time: "09:00", jobs: { status: "scheduled" } }],
      [
        { id: "l2", assigned_agent_id: "a", scheduled_date: "2026-09-29", status: "accepted", customer_name: "Bob" },
        { id: "l3", assigned_agent_id: "a", scheduled_date: "2026-09-20", status: "completed" },
        { id: "l4", assigned_agent_id: null, scheduled_date: "2026-09-29", status: "accepted" },
      ],
    );
    const rows = buildBoardRows([job("j1", "in_progress")], entries);
    expect(rows.filter((r) => r.id === "j1")).toHaveLength(1);
    const g = groupBoardRows(rows, false);
    expect(g.columns.in_progress.map((r) => r.id)).toEqual(["j1"]);
    expect(g.columns.scheduled.map((r) => `${r.kind}:${r.id}`)).toEqual(["lead:l2"]);
    expect(g.columns.completed.map((r) => r.id)).toEqual(["l3"]);
  });
  it("row click targets", () => {
    expect(rowTarget({ kind: "job", id: "j1" })).toBe("/admin/jobs/j1");
    expect(rowTarget({ kind: "lead", id: "l1" })).toBe("/admin/dispatch?lead=l1");
  });
});
