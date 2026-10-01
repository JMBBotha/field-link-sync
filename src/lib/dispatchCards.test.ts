import { describe, it, expect } from "vitest";
import { jobUrgency, sortDispatchJobs, pillFor, techStrip, NEXT_STATUS, fmtMins } from "@/lib/dispatchCards";

const now = new Date("2026-10-01T10:00:00+02:00");
const tech = (id = "t1", name = "Pieter Nel") => [{ profile_id: id, status: "accepted", profiles: { full_name: name, phone: "0820000000" } }];
const J = (id: string, o: any = {}) => ({ id, title: id, status: "scheduled", scheduled_for: "2026-10-01T15:00:00+02:00", assignments: tech(), ...o });

describe("dispatchCards", () => {
  it("ranks by urgency in the agreed order", () => {
    const jobs = [
      J("done", { status: "completed", scheduled_for: "2026-10-01T07:30:00+02:00" }),
      J("later"),
      J("onsite", { status: "in_progress", scheduled_for: "2026-10-01T08:00:00+02:00" }),
      J("enroute", { status: "dispatched", scheduled_for: "2026-10-01T13:00:00+02:00" }),
      J("soon", { scheduled_for: "2026-10-01T11:30:00+02:00" }),
      J("urgent", { priority: "urgent" }),
      J("unassigned14", { scheduled_for: "2026-10-01T14:00:00+02:00", assignments: [] }),
      J("unassigned11", { scheduled_for: "2026-10-01T11:00:00+02:00", assignments: [{ profile_id: "x", status: "rejected" }] }),
      J("late", { status: "dispatched", scheduled_for: "2026-10-01T09:30:00+02:00" }),
      J("cancelled", { status: "cancelled" }),
      J("tomorrow", { scheduled_for: "2026-10-02T09:00:00+02:00" }),
    ];
    expect(sortDispatchJobs(jobs, "2026-10-01", now).map((j) => j.id))
      .toEqual(["late", "unassigned11", "unassigned14", "urgent", "soon", "enroute", "onsite", "later", "done"]);
    expect(jobUrgency(J("x", { status: "dispatched", scheduled_for: "2026-10-01T09:35:00+02:00" }), now)).toMatchObject({ key: "late", mins: -25 });
  });

  it("pills, next status and minutes", () => {
    expect(pillFor(J("a", { assignments: [] })).label).toBe("UNASSIGNED");
    expect(pillFor(J("b", { status: "dispatched" })).label).toBe("EN ROUTE");
    expect(pillFor(J("c", { status: "in_progress", assignments: [] })).label).toBe("ON SITE");
    expect(NEXT_STATUS.scheduled.to).toBe("dispatched");
    expect(NEXT_STATUS.in_progress.to).toBe("completed");
    expect(fmtMins(140)).toBe("2h 20m");
    expect(fmtMins(25)).toBe("25m");
  });

  it("tech strip: state, counts, late and next start", () => {
    const day = sortDispatchJobs([
      J("p1", { status: "dispatched", scheduled_for: "2026-10-01T09:30:00+02:00" }),
      J("p2", { scheduled_for: "2026-10-01T13:00:00+02:00" }),
      J("s1", { status: "in_progress", assignments: tech("t2", "Sipho M.") }),
      J("k1", { scheduled_for: "2026-10-01T15:00:00+02:00", assignments: tech("t3", "Thabo K.") }),
      J("u1", { assignments: [] }),
    ], "2026-10-01", now);
    const rows = techStrip(day, now);
    expect(rows.map((r) => [r.name, r.state, r.jobs, r.late])).toEqual([
      ["Pieter Nel", "en_route", 2, 1], ["Sipho M.", "on_site", 1, 0], ["Thabo K.", "next", 1, 0],
    ]);
    expect(rows[0].next).toBe("2026-10-01T09:30:00+02:00");
  });
});
