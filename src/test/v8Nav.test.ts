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
    expect(v8Primary("admin").map((l) => l.label)).toEqual(["Home", "Jobs", "Invoices", "Stock", "Schedule"]);
    expect(v8Primary("sales").map((l) => l.label)).toEqual(["Home", "Pipeline", "Quotes", "Schedule", "Clients"]);
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
    expect(g.map((x) => x.title)).toEqual(["Jobs & requests", "Money", "Suppliers & stock", "Team & settings", "Platform (Massair)"]);
    const paths = [...v8Primary("admin"), ...g.flatMap((x) => x.links)].map((l) => l.path);
    for (const dead of ["/admin/payments", "/admin/projects", "/admin/portal", "/admin/whatsapp", "/admin/dispatch", "/admin/network-agents", "/admin/price-lists", "/admin/consumables", "/admin/brochures", "/admin/analytics", "/admin/cashflow"]) expect(paths).not.toContain(dead);
    const key = (p: string) => (p.includes("tab=") ? p : p.split("?")[0]);
    expect(new Set(paths.map(key)).size).toBe(paths.length);
    expect(v8Tabs("admin").map((l) => l.label)).toEqual(["Home", "Jobs", "Invoices", "Schedule"]);
    expect(v8Tabs("sales").map((l) => l.label)).toEqual(["Home", "Pipeline", "Quotes", "Clients"]);
    expect(v8IsActive(v8Primary("admin").find((l) => l.label === "Schedule")!, "/admin/jobs", "?tab=dispatch")).toBe(true);
    const mgr = v8More("owner", { manager: true }).flatMap((x) => x.links).map((l) => l.path);
    expect(mgr).not.toContain("/admin/money");
    expect(mgr).not.toContain("/admin/settings");
  });
  it("supplier pages bundled; Supplier docs added and hidden from sales", () => {
    const g = v8More("admin").find((x) => x.title === "Suppliers & stock")!.links.map((l) => l.path);
    expect(g).toEqual(expect.arrayContaining(["/admin/suppliers", "/admin/supplier-docs", "/admin/supplier-bills"]));
    expect(v8More("sales").flatMap((x) => x.links).some((l) => l.path === "/admin/supplier-docs")).toBe(false);
    const mgr = v8More("owner", { manager: true }).flatMap((x) => x.links).map((l) => l.path);
    expect(mgr).toContain("/admin/supplier-docs");
    expect(mgr).not.toContain("/admin/supplier-bills");
  });
  it("Live map stays reachable for admin from More, and sales never see it", () => {
    const adminMore = v8More("admin").flatMap((x) => x.links);
    expect(adminMore.some((l) => l.path === "/admin/map")).toBe(true);
    expect(v8Primary("sales").some((l) => l.path === "/admin/map")).toBe(false);
    expect(v8More("sales").flatMap((x) => x.links).some((l) => l.path === "/admin/map")).toBe(false);
    expect(v8Primary("admin").some((l) => l.path === "/admin/map")).toBe(false);
    expect(v8Primary("owner").some((l) => l.path === "/admin/map")).toBe(false);
    expect(v8Tabs("admin").some((l) => l.path === "/admin/map")).toBe(false);
    expect(v8Tabs("sales").some((l) => l.path === "/admin/map")).toBe(false);
    expect(v8IsActive(v8Primary("admin")[0], "/admin/map")).toBe(false);
    expect(v8IsActive(adminMore.find((l) => l.path === "/admin/map")!, "/admin/map")).toBe(true);
    expect(v8More("sales").flatMap((x) => x.links).some((l) => l.path === "/admin/invoices")).toBe(true);
    expect(v8More("admin").flatMap((x) => x.links).some((l) => l.label === "Clients")).toBe(true);
    expect(v8More("admin").flatMap((x) => x.links).some((l) => l.label === "Reports")).toBe(true);
  });
  it("marks the active area", () => {
    const pipe = v8More("admin").flatMap((g) => g.links).find((l) => l.label === "Pipeline")!;
    expect(v8IsActive(pipe, "/admin/quote-builder")).toBe(true);
    expect(v8IsActive(pipe, "/admin/jobs", "?tab=dispatch")).toBe(false);
    expect(v8IsActive(v8Primary("admin")[0], "/admin/customers")).toBe(false);
  });
});
