import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { v8RoleOf, v8Primary, v8More, v8IsActive } from "@/components/v8/v8Nav";

const all = (r: any) => [...v8Primary(r), ...v8More(r).flatMap((g) => g.links)].map((l) => l.path);
describe("v8 Simple navigation", () => {
  it("picks the role", () => {
    expect(v8RoleOf({ isAdmin: false, isDispatcher: false, isFieldAgent: true, isSalesRep: false, isMainCo: true })).toBe("tech");
    expect(v8RoleOf({ isAdmin: false, isDispatcher: true, isFieldAgent: false, isSalesRep: true, isMainCo: true })).toBe("sales");
    expect(v8RoleOf({ isAdmin: true, isDispatcher: false, isFieldAgent: false, isSalesRep: false, isMainCo: false })).toBe("owner");
  });
  it("admin has 5 areas + More; techs never see leads; owners no Platform", () => {
    expect(v8Primary("admin").map((l) => l.label)).toEqual(["Home", "Pipeline", "Schedule", "Clients", "Money"]);
    expect(all("tech").some((p) => /dispatch|leads|pipeline|customers/.test(p))).toBe(false);
    expect(v8More("owner").some((g) => g.title.startsWith("Platform"))).toBe(false);
    expect(v8More("admin").some((g) => g.title.startsWith("Platform"))).toBe(true);
  });
  it("every admin link is a real route", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    for (const p of all("admin")) {
      const base = p.split("?")[0];
      const leaf = base.replace(/^\/admin\//, "");
      expect(app.includes(`path="${base}"`) || app.includes(`path="${leaf}"`)).toBe(true);
    }
  });
  it("marks the active area", () => {
    const pipe = v8Primary("admin")[1];
    expect(v8IsActive(pipe, "/admin/quote-builder")).toBe(true);
    expect(v8IsActive(pipe, "/admin/jobs", "?tab=dispatch")).toBe(false);
    expect(v8IsActive(v8Primary("admin")[0], "/admin/customers")).toBe(false);
  });
});
