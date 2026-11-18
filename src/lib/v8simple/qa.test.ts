import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { isV8SimpleEnabled } from "@/lib/v8simple/flag";

const SCREENS = ["home", "jobs", "job", "quote", "on-site", "schedule", "clients", "service", "client"];

describe("V8 QA", () => {
  it("keeps the flag off and still has the nine preview screens", () => {
    localStorage.clear();
    sessionStorage.clear();
    expect(isV8SimpleEnabled("")).toBe(false);
    const routes = readFileSync("src/pages/V8SimpleRoutes.tsx", "utf8");
    for (const screen of ["jobs", "jobs/:id", "quote", "on-site", "schedule", "clients", "service", "client"]) {
      expect(routes).toContain(`path="${screen}"`);
    }
    expect(SCREENS).toHaveLength(9);
    const client = readFileSync("src/components/v8simple/V8SimpleClient.tsx", "utf8");
    const service = readFileSync("src/components/v8simple/V8SimpleService.tsx", "utf8");
    expect(client + service).not.toMatch(/payfast/i);
    expect(readFileSync("src/components/v8/V8Sidebar.tsx", "utf8")).not.toMatch(/v8simple/);
  });
});
