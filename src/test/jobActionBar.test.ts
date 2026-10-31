import { describe, it, expect } from "vitest";
import { jobActionBar, jhbLocalToIso, completedLabel, photoSummary } from "@/lib/jobActionBar";

const admin = { admin: true, rep: false, tech: false };
const rep = { admin: false, rep: true, tech: false };
const tech = { admin: false, rep: false, tech: true };

describe("jobActionBar", () => {
  it("scheduled: Start for runners, Mark completed for admins", () => {
    expect(jobActionBar("scheduled", tech, true)).toMatchObject({ primary: "start", canMarkCompleted: false, completedBadge: false });
    expect(jobActionBar("scheduled", admin, true)).toMatchObject({ primary: "start", canMarkCompleted: true });
  });
  it("sales login without tech assignment gets no Start", () => {
    expect(jobActionBar("scheduled", rep, false).primary).toBeNull();
    expect(jobActionBar("scheduled", { ...rep, admin: true }, false)).toMatchObject({ primary: null, canMarkCompleted: true });
  });
  it("in progress: Complete", () => {
    expect(jobActionBar("in_progress", tech, true).primary).toBe("complete");
  });
  it("completed: badge, no Start, Reopen admin only", () => {
    expect(jobActionBar("completed", admin, true)).toEqual({ primary: null, completedBadge: true, canMarkCompleted: false, canReopen: true });
    expect(jobActionBar("completed", tech, true)).toMatchObject({ primary: null, completedBadge: true, canReopen: false });
  });
  it("cancelled: nothing", () => {
    expect(jobActionBar("cancelled", admin, true)).toEqual({ primary: null, completedBadge: false, canMarkCompleted: false, canReopen: false });
  });
});

describe("helpers", () => {
  it("converts SAST wall time to UTC", () => {
    expect(jhbLocalToIso("2026-10-30", "09:30")).toBe("2026-10-30T07:30:00.000Z");
    expect(jhbLocalToIso("30/10/2026", "9:30")).toBeNull();
  });
  it("labels completion in SAST", () => {
    expect(completedLabel("2026-10-30T07:30:00Z")).toBe("Completed 30 Oct 2026, 09:30");
  });
  it("empty only when all three types are empty", () => {
    expect(photoSummary({ site: 3, before: 0, after: 0 }).empty).toBe(false);
    expect(photoSummary({ site: 0, before: 0, after: 0 }).empty).toBe(true);
  });
});
