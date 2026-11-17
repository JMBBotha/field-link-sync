import { describe, it, expect } from "vitest";
import { bookingFromJob, bookingFromLead, formatBookingWhen, bookingLine, bookingSummaryLine, isBookableStatus, isServiceBooking, visitAgentId } from "@/lib/leadBooking";
import { alertKey, dueAlertLevels, rememberAlert } from "@/lib/noTechVisit";

describe("leadBooking", () => {
  const job = { id: "a7db46f4", lead_id: "0559f00b", status: "scheduled", scheduled_for: "2026-10-14T07:30:00+00:00",
    assignments: [{ profile_id: "t1", created_at: "2026-10-13", status: "assigned", profiles: { full_name: "Innocent Mattienga" } }] };
  it("open job with a tech is Booked with tech + SAST time", () => {
    const b = bookingFromJob(job)!;
    expect(b.techName).toBe("Innocent Mattienga");
    expect(formatBookingWhen(b.when)).toBe("14 Oct 09:30");
    expect(bookingLine(b)).toBe("Booked · Innocent Mattienga · 14 Oct 09:30");
  });
  it("no tech, completed or cancelled is not Booked", () => {
    expect(bookingFromJob({ ...job, assignments: [] })).toBeNull();
    expect(bookingFromJob({ ...job, status: "completed" })).toBeNull();
    expect(bookingFromJob({ ...job, status: "cancelled" })).toBeNull();
  });
  it("falls back to job_schedules for time and tech", () => {
    const b = bookingFromJob({ ...job, scheduled_for: null, assignments: [] }, { job_id: "a7db46f4", agent_id: "t1", scheduled_date: "2026-10-14", start_time: "09:30:00" }, new Map([["t1", "Innocent Mattienga"]]))!;
    expect(bookingLine(b)).toBe("Booked · Innocent Mattienga · 14 Oct 09:30");
  });
  it("summary line names the technician, the day and the hours", () => {
    expect(bookingSummaryLine({
      kind: "Service", personName: "Innocent Mattienga", personRole: "technician",
      date: "2026-11-19", start: "10:00", end: "13:00",
    })).toBe("Service · Innocent Mattienga · Thu 19 Nov · 10:00–13:00");
  });
  it("puts a red-chip label where the technician name would be", () => {
    expect(bookingSummaryLine({ kind: "Service", date: "2026-11-19", start: "10:00", end: "13:00", noTechnician: true }))
      .toBe("Service · No technician · Thu 19 Nov · 10:00–13:00");
  });
  it("names a salesperson and says no technician yet", () => {
    expect(bookingSummaryLine({
      kind: "Service", personName: "Almari Cloete", personRole: "sales",
      date: "2026-11-19", start: "10:00", end: "13:00", noTechnician: true,
    })).toBe("Service · Almari Cloete (sales) · no technician yet · Thu 19 Nov · 10:00–13:00");
  });
  it("does not copy a salesperson onto a service visit", () => {
    expect(isServiceBooking({ primary_intent: "service", service_type: "Technical/Repairs" })).toBe(true);
    expect(isServiceBooking({ primary_intent: "sales", service_type: "Sales/Consultation" })).toBe(false);
    expect(visitAgentId("sales-1", false, true)).toBeNull();
    expect(visitAgentId("tech-1", true, true)).toBe("tech-1");
    expect(visitAgentId("sales-1", false, false)).toBe("sales-1");
  });
  it("sends each alert level once per visit and person", () => {
    const start = new Date("2026-11-19T08:00:00Z");
    const sent = new Set<string>();
    const first = dueAlertLevels(start, new Date("2026-11-17T08:00:00Z"));
    expect(first).toEqual(["now", "h48"]);
    for (const level of first) expect(rememberAlert(sent, "visit-1", level, "admin-1")).toBe(true);
    expect(rememberAlert(sent, "visit-1", "now", "admin-1")).toBe(false);
    expect(alertKey("visit-1", "now", "admin-1")).toBe("visit-1:now:admin-1");
    expect(dueAlertLevels(start, new Date("2026-11-18T09:00:00Z"), ["now", "h48"])).toEqual(["h24"]);
    expect(dueAlertLevels(start, new Date("2026-11-19T09:00:00Z"), ["now"])).toEqual([]);
  });
  it("lead with own tech + date is Booked; in progress keeps its own status", () => {
    expect(bookingFromLead({ status: "accepted", assigned_agent_id: "t1", scheduled_date: "2026-10-14", scheduled_time: "09:30" }, "X")).not.toBeNull();
    expect(bookingFromLead({ status: "pending", assigned_agent_id: null, scheduled_date: "2026-10-14" })).toBeNull();
    expect(isBookableStatus("in_progress")).toBe(false);
  });
});
