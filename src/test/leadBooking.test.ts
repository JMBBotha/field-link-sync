import { describe, it, expect } from "vitest";
import { bookingFromJob, bookingFromLead, formatBookingWhen, bookingLine, isBookableStatus } from "@/lib/leadBooking";

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
  it("lead with own tech + date is Booked; in progress keeps its own status", () => {
    expect(bookingFromLead({ status: "accepted", assigned_agent_id: "t1", scheduled_date: "2026-10-14", scheduled_time: "09:30" }, "X")).not.toBeNull();
    expect(bookingFromLead({ status: "pending", assigned_agent_id: null, scheduled_date: "2026-10-14" })).toBeNull();
    expect(isBookableStatus("in_progress")).toBe(false);
  });
});
