import { describe, it, expect } from "vitest";
import { periodRange, prevRange, shiftMonths, metric, delta, aging, funnel, jobBuckets, lastMonths, type DashData } from "./dashboardV7";

const NOW = Date.parse("2026-10-13T12:00:00+02:00");
const D: DashData = {
  leads: [{ id: "a", created_at: "2026-10-13T08:00:00+02:00", first_contact_at: "x" }, { id: "b", created_at: "2026-10-01T09:00:00+02:00", scheduled_date: "2026-10-03" }, { id: "c", created_at: "2025-10-05T09:00:00+02:00" }],
  quotes: [{ lead_id: "b", sent_at: "2026-10-02T10:00:00+02:00", accepted_at: "2026-10-04T10:00:00+02:00", status: "accepted" }, { lead_id: "a", sent_at: "2026-10-13T09:00:00+02:00", status: "sent" }],
  invoices: [{ status: "paid", grand_total: 1000, issue_date: "2026-10-02", paid_date: "2026-10-05" }, { status: "sent", grand_total: 500, issue_date: "2026-07-01", due_date: "2026-07-08" }, { status: "draft", grand_total: 99, issue_date: "2026-10-02" }],
  jobs: [{ status: "completed", completed_at: "2026-10-12T15:00:00+02:00" }, { status: "scheduled", scheduled_for: "2026-10-01T08:00:00+02:00" }, { status: "scheduled", awaiting_stock: true }],
  commissions: null,
};

describe("dashboardV7", () => {
  it("periods start at SAST midnight / Monday / 1st", () => {
    expect(new Date(periodRange("today", NOW).start).toISOString()).toBe("2026-10-12T22:00:00.000Z");
    expect(new Date(periodRange("week", NOW).start).toISOString()).toBe("2026-10-11T22:00:00.000Z");
    expect(new Date(periodRange("month", NOW).start).toISOString()).toBe("2026-09-30T22:00:00.000Z");
    expect(new Date(periodRange("quarter", NOW).start).toISOString()).toBe("2026-09-30T22:00:00.000Z");
  });
  it("prev and LY windows", () => {
    const m = periodRange("month", NOW);
    expect(prevRange(m).end).toBe(m.start);
    expect(new Date(shiftMonths(m, -12).start).toISOString()).toBe("2025-09-30T22:00:00.000Z");
  });
  it("metrics", () => {
    const m = periodRange("month", NOW);
    expect(metric(D, "new_leads", m)).toBe(2);
    expect(metric(D, "quotes_sent", m)).toBe(2);
    expect(metric(D, "conversion", m)).toBe(50);
    expect(metric(D, "invoiced", m)).toBe(1000);
    expect(metric(D, "paid", m)).toBe(1000);
    expect(metric(D, "commission", m)).toBeNull();
    expect(metric(D, "new_leads", shiftMonths(m, -12))).toBe(1);
    expect(delta(2, 1)).toBe(100); expect(delta(1, 0)).toBeNull();
  });
  it("aging, funnel, jobs, months", () => {
    expect(aging(D.invoices, NOW)[3].amount).toBe(500);
    expect(funnel(D, periodRange("month", NOW)).map((s) => s.value)).toEqual([2, 1, 1, 2, 1]);
    expect(jobBuckets(D.jobs, NOW)).toEqual({ overdue: 1, scheduled: 0, in_progress: 0, waiting: 1, completed: 1 });
    const ms = lastMonths(NOW); expect(ms).toHaveLength(12); expect(ms[11].label).toBe("Oct");
  });
});
