import { describe, it, expect } from "vitest";
import { blockKind, blockPos, jhbMinutes, snapStart, needsYou, ageTone, calmEnabled, jhbIso, dayProgress } from "./jobsCalm";

const u = (key: any) => ({ key, rank: 0, mins: null });
describe("jobsCalm", () => {
  it("kinds", () => {
    expect(blockKind({ lane: "install", title: "x", statusKey: "scheduled", urgency: u("later") })).toBe("install");
    expect(blockKind({ lane: "service", title: "Maintenance 3 units", statusKey: "scheduled", urgency: u("later") })).toBe("maintenance");
    expect(blockKind({ lane: "service", title: "Repair", statusKey: "scheduled", urgency: u("later") })).toBe("service");
    expect(blockKind({ lane: "sales", title: "Visit", statusKey: "scheduled", urgency: u("later") })).toBe("sales");
    expect(blockKind({ lane: "install", title: "x", statusKey: "completed", urgency: u("done") })).toBe("done");
    expect(blockKind({ lane: "install", title: "x", statusKey: "scheduled", urgency: u("late") })).toBe("late");
  });
  it("time", () => {
    expect(jhbMinutes("2026-10-20T08:30:00+02:00")).toBe(510);
    expect(jhbMinutes("2026-10-20T06:30:00Z")).toBe(510);
    expect(jhbMinutes("2026-10-20")).toBeNull();
    expect(blockPos(480, 540)).toEqual({ left: 0, width: 100 });
    expect(blockPos(1100, 60)).toBeNull();
    expect(snapStart(0.5)).toBe(750);
    expect(jhbIso("2026-10-20", 570)).toBe("2026-10-20T09:30:00+02:00");
    expect(dayProgress(["done", "install"])).toBe(50);
  });
  it("chips max 3, drop zeros", () => {
    expect(needsYou({ leadsNotContacted: 2, late: 0, unassigned: 1 }).map((c) => c.key)).toEqual(["leads", "unassigned"]);
  });
  it("age tone", () => {
    const now = new Date("2026-10-20T10:00:00Z");
    expect(ageTone("2026-10-20T09:50:00Z", now).tone).toBe("green");
    expect(ageTone("2026-10-20T09:30:00Z", now).tone).toBe("amber");
    expect(ageTone("2026-10-20T08:00:00Z", now).tone).toBe("red");
  });
  it("flag off by default", () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    expect(calmEnabled("", s)).toBe(false);
    expect(calmEnabled("?jobs=calm", s)).toBe(true);
    expect(calmEnabled("", s)).toBe(true);
    expect(calmEnabled("?jobs=classic", s)).toBe(false);
    expect(calmEnabled("", s)).toBe(false);
  });
});
