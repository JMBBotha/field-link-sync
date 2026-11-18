import { describe, it, expect } from "vitest";
import { v8Checklist, v8JobDoneReady, v8TechPush } from "@/lib/v8simple/onsite";

describe("on site", () => {
  it("keeps Job done off until the checklist, photos and sign-off are done", () => {
    const checks = v8Checklist("install").map(() => false);
    expect(v8JobDoneReady({ checks, photos: 0, signed: false })).toBe(false);
    expect(v8JobDoneReady({ checks: checks.map(() => true), photos: 1, signed: true })).toBe(false);
    expect(v8JobDoneReady({ checks: checks.map(() => true), photos: 2, signed: false })).toBe(false);
    expect(v8JobDoneReady({ checks: checks.map(() => true), photos: 2, signed: true })).toBe(true);
    expect(v8Checklist("service")).toContain("Recorded R410 or R32");
  });

  it("leaves the client name out of the push", () => {
    const text = v8TechPush({ type: "Installation", area: "Gardens", clientName: "Demo client F" });
    expect(text).toBe("Installation · Gardens · tap to view");
    expect(text).not.toMatch(/Demo client/);
  });
});
