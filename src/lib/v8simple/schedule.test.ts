import { describe, it, expect } from "vitest";
import { V8_DEMO_JOBS } from "@/lib/v8simple/demoJobs";
import { V8_QUOTE_OPTIONS } from "@/lib/v8simple/quote";
import { v8AssignTech, v8ScheduleBoard, v8SchedulePack, v8TechCanSee } from "@/lib/v8simple/schedule";

describe("schedule", () => {
  it("keeps unaccepted quotes off the board and shows deposit-paid installs and call-outs", () => {
    const board = v8ScheduleBoard(V8_DEMO_JOBS);
    const ids = board.map((row) => row.id);
    expect(ids).not.toContain("lead-1");
    expect(ids).not.toContain("visit-1");
    expect(ids).not.toContain("quote-1");
    expect(ids).not.toContain("dep-1");
    expect(ids).toContain("ready-1");
    expect(ids).toContain("svc-1");
  });

  it("shows a job to the technician only after they are assigned, with the pack list", () => {
    const ready = V8_DEMO_JOBS.find((row) => row.id === "ready-1")!;
    expect(v8TechCanSee(ready.input, "tech-a")).toBe(false);
    const assigned = v8AssignTech(ready, "tech-a");
    expect(v8TechCanSee(assigned.input, "tech-a")).toBe(true);
    expect(v8TechCanSee(assigned.input, "tech-b")).toBe(false);
    const pack = v8SchedulePack(V8_QUOTE_OPTIONS[0].lines);
    expect(pack.map((line) => line.name)).toEqual(["9 000 BTU midwall", "Copper pipe"]);
  });
});
