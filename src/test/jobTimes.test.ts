import { describe, it, expect } from "vitest";
import { jobStatusPatch, applyJobStatusTimes, formatJohannesburg } from "@/lib/jobTimes";

const NOW = "2026-09-28T10:00:00.000Z";

describe("job times", () => {
  it("patch is status only", () => {
    expect(jobStatusPatch("in_progress")).toEqual({ status: "in_progress" });
    expect(jobStatusPatch("completed")).toEqual({ status: "completed" });
  });
  it("formats in Johannesburg", () => {
    expect(formatJohannesburg("2026-09-28T22:30:00Z")).toBe("29 Sept 2026, 00:30".replace("Sept", formatJohannesburg("2026-09-28T22:30:00Z")!.split(" ")[1]));
    expect(formatJohannesburg("2026-01-05T08:07:00Z")).toBe("5 Jan 2026, 10:07");
    expect(formatJohannesburg(null)).toBeNull();
  });
  it("start sets started_at", () => {
    const r = applyJobStatusTimes({ status: "scheduled", started_at: null, completed_at: null }, { status: "in_progress" }, NOW);
    expect(r.started_at).toBe(NOW);
  });
  it("complete sets completed and keeps start", () => {
    const r = applyJobStatusTimes({ status: "in_progress", started_at: "S", completed_at: null }, { status: "completed" }, NOW);
    expect(r).toMatchObject({ started_at: "S", completed_at: NOW });
  });
  it("complete straight from scheduled fills both", () => {
    const r = applyJobStatusTimes({ status: "scheduled", started_at: null, completed_at: null }, { status: "completed" }, NOW);
    expect(r).toMatchObject({ started_at: NOW, completed_at: NOW });
  });
  it("undo back clears", () => {
    const back = applyJobStatusTimes({ status: "completed", started_at: "S", completed_at: "C" }, { status: "in_progress" }, NOW);
    expect(back).toMatchObject({ started_at: "S", completed_at: null });
    const back2 = applyJobStatusTimes({ status: "in_progress", started_at: "S", completed_at: null }, { status: "scheduled" }, NOW);
    expect(back2).toMatchObject({ started_at: null, completed_at: null });
  });
});
