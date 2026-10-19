import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { v8RoleOf, v8Primary, v8More, v8IsActive, v8Tabs } from "@/components/v8/v8Nav";

const all = (r: any) => [...v8Primary(r), ...v8More(r).flatMap((g) => g.links)].map((l) => l.path);
describe("v8 Simple navigation", () => {
  it("picks the role", () => {
    expect(v8RoleOf({ isAdmin: false, isDispatcher: false, isFieldAgent: true, isSalesRep: false, isMainCo: true })).toBe("tech");
    expect(v8RoleOf({ isAdmin: false, isDispatcher: true, isFieldAgent: false, isSalesRep: true, isMainCo: true })).toBe("sales");
    expect(v8RoleOf({ isAdmin: true, isDispatcher: false, isFieldAgent: false, isSalesRep: false, isMainCo: false })).toBe("owner");
  });
  it("admin pins 6 areas incl. Quotes + Invoices; techs never see leads; owners no Platform", () => {
    expect(v8Primary("admin").map((l) => l.label)).toEqual(["Home", "Pipeline", "Schedule", "Clients", "Quotes", "Invoices"]);
    expect(v8Primary("sales").map((l) => l.label)).toEqual(["Home", "My pipeline", "My visits", "Clients", "Quotes", "Invoices"]);
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
  it("groups: max 5 headings, no duplicate or dead links, phones keep 4 tabs + More", () => {
    const g = v8More("admin", { cashHealth: true });
    expect(g.map((x) => x.title)).toEqual(["Work", "Money", "Catalogue & stock", "Team & settings", "Platform (Massair)"]);
    const paths = [...v8Primary("admin"), ...g.flatMap((x) => x.links)].map((l) => l.path);
    for (const dead of ["/admin/payments", "/admin/projects", "/admin/portal", "/admin/whatsapp", "/admin/dispatch", "/admin/network-agents", "/admin/price-lists", "/admin/consumables", "/admin/brochures", "/admin/analytics", "/admin/cashflow"]) expect(paths).not.toContain(dead);
    expect(new Set(paths.map((p) => p.split("?")[0] + (p.includes("tab=stock") ? "#stock" : ""))).size).toBe(paths.length);
    expect(v8Tabs("admin").length).toBeLessThanOrEqual(4);
    expect(v8Tabs("sales").length).toBeLessThanOrEqual(4);
    const mgr = v8More("owner", { manager: true }).flatMap((x) => x.links).map((l) => l.path);
    expect(mgr).not.toContain("/admin/money");
    expect(mgr).not.toContain("/admin/settings");
    expect(v8IsActive(v8Primary("admin")[2], "/admin/jobs", "?tab=dispatch")).toBe(true);
  });
  it("marks the active area", () => {
    const pipe = v8Primary("admin")[1];
    expect(v8IsActive(pipe, "/admin/quote-builder")).toBe(true);
    expect(v8IsActive(pipe, "/admin/jobs", "?tab=dispatch")).toBe(false);
    expect(v8IsActive(v8Primary("admin")[0], "/admin/customers")).toBe(false);
  });
});
