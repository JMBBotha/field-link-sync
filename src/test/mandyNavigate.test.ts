import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { APP_ROUTES } from "@/lib/mandy/appRoutes";
import {
  navAuditData,
  parseNavigateUtterance,
  resolvePage,
  runNavigateTo,
  type NavActor,
  type NavHit,
  type NavSearch,
} from "@/lib/mandy/navigateTo";
import { indexAppRoutes, followRedirect, matchRoute, roleAllows } from "@/lib/mandy/routeIndex";
import { isSystemTool, toolAllowed } from "../../supabase/functions/_shared/mandyPolicy";
import { realtimeInstructions, NAVIGATE_RULE } from "../../supabase/functions/_shared/mandyRealtime";

const source = readFileSync("src/App.tsx", "utf8");
const routes = indexAppRoutes(source);

const admin: NavActor = { ready: true, roles: ["admin"], salesRep: false, platformOwner: true, companyOwner: true };
const office: NavActor = { ready: true, roles: ["dispatcher"], salesRep: false, platformOwner: false, companyOwner: false };
const sales: NavActor = { ready: true, roles: ["dispatcher"], salesRep: true, platformOwner: false, companyOwner: false };
const tech: NavActor = { ready: true, roles: ["field_agent"], salesRep: false, platformOwner: false, companyOwner: false };
const viewer: NavActor = { ready: true, roles: ["viewer"], salesRep: false, platformOwner: false, companyOwner: false };

const Q63 = "11111111-1111-4111-8111-111111111111";
const Q12 = "22222222-2222-4222-8222-222222222222";
const INV = "33333333-3333-4333-8333-333333333333";

function searchOf(rows: NavHit[]): NavSearch {
  return {
    search: async (entity, query) => rows.filter((r) => {
      if (r.entity !== entity) return false;
      const blob = `${r.reference || ""} ${r.chip}`.toLowerCase();
      return blob.includes(query.toLowerCase().replace(/\s+/g, "")) || blob.includes(query.toLowerCase());
    }),
  };
}

const quotes: NavHit[] = [
  { id: Q63, entity: "quote", reference: "Q-2026-0063", chip: "Q-2026-0063 · Hennie" },
  { id: Q12, entity: "quote", reference: "Q-2026-0012", chip: "Q-2026-0012 · Hennie" },
];
const invoices: NavHit[] = [
  { id: INV, entity: "invoice", reference: "INV-045", chip: "INV-045 · Hennie" },
];

describe("route index from the router", () => {
  it("indexes the same routes the raw router source does", () => {
    expect(APP_ROUTES.map((r) => r.path).sort()).toEqual(routes.map((r) => r.path).sort());
  });

  it("keeps the guards written on the route", () => {
    const yard = matchRoute("/admin/yard", routes);
    expect(yard?.allowedRoles).toEqual(["admin"]);
    expect(yard?.denySalesRep).toBe(true);

    const map = matchRoute("/admin/map", routes);
    expect(map?.denySalesRep).toBe(true);
    expect(map?.allowedRoles).toEqual(["admin", "dispatcher", "viewer", "field_agent"]);

    const jobs = matchRoute("/admin/jobs", routes);
    expect(jobs?.allowedRoles).toEqual(["admin", "dispatcher", "viewer"]);
    expect(jobs?.redirectOnDeny).toBe(true);
    expect(jobs?.redirectTo).toBe("/admin/my-jobs");

    expect(matchRoute("/admin/invoices", routes)?.allowedRoles).toBeNull();
    expect(matchRoute("/admin/quotes", routes)?.denySalesRep).toBe(false);
    expect(matchRoute("/admin/customers/:id", routes)?.path).toBe("/admin/customers/:id");
    expect(matchRoute("/admin/estimates/:id", routes)?.path).toBe("/admin/estimates/:id");

    const stock = matchRoute("/admin/cash-health", routes);
    expect(stock?.allowedRoles).toEqual(["admin"]);
    expect(stock?.denySalesRep).toBe(true);
    expect(matchRoute("/admin/inventory", routes)?.staticRedirect).toBe("/admin/cash-health?tab=stock");

    expect(matchRoute("/admin/settings", routes)?.allowedRoles).toEqual(["admin"]);
    expect(matchRoute("/admin/team", routes)?.allowedRoles).toEqual(["admin"]);
    expect(matchRoute("/admin/reports", routes)?.denySalesRep).toBe(true);
    expect(matchRoute("/admin/reports/advanced", routes)?.platformOwner).toBe(true);
    expect(matchRoute("/admin/money", routes)?.companyOwner).toBe(true);
    expect(matchRoute("/admin/companies", routes)?.platformOwner).toBe(true);
    expect(matchRoute("/field", routes)?.salesRepRedirect).toBe(true);
    expect(matchRoute("/field/schedule", routes)?.allowedRoles).toEqual(expect.arrayContaining(["field_agent"]));
    expect(matchRoute("/field/jobs/:id", routes)?.allowedRoles).toEqual(["field_agent", "admin", "dispatcher"]);
    expect(matchRoute("/admin/dispatch", routes)?.redirectKind).toBe("dispatch-calendar");
  });
});

describe("spoken intent → route", () => {
  it("opens the dashboard, invoices and a quote number", async () => {
    expect(parseNavigateUtterance("open dashboard")).toEqual({ kind: "page", pageId: "dashboard" });
    expect(parseNavigateUtterance("open invoices")).toEqual({ kind: "page", pageId: "invoices" });
    expect(parseNavigateUtterance("show invoice INV-045")).toEqual({ kind: "record", entity: "invoice", query: "INV-045" });
    expect(parseNavigateUtterance("open quote Q-2026-0063")?.kind).toBe("record");

    const home = resolvePage("dashboard", admin, routes);
    expect(home.kind).toBe("go");
    if (home.kind === "go") {
      expect(home.route).toBe("/admin");
      expect(home.say).toBe("Opening Dashboard.");
    }

    const inv = resolvePage("invoices", admin, routes);
    expect(inv).toMatchObject({ kind: "go", route: "/admin/invoices", say: "Opening Invoices." });

    const go = vi.fn();
    const opened = await runNavigateTo(
      { utterance: "open quote Q-2026-0063" },
      { actor: admin, routes, search: searchOf(quotes), go },
    );
    expect(go).toHaveBeenCalledWith(`/admin/estimates/${Q63}`);
    expect(opened.ok).toBe(true);
    expect(opened.message).toBe("Opening quote Q-2026-0063.");
    expect(opened.message).not.toMatch(/Hennie/);
    expect(JSON.stringify(opened.data)).not.toMatch(/Hennie|phone|email|address/);
    expect(navAuditData(opened.data ? {
      kind: "go",
      route: String(opened.data.route),
      label: String(opened.data.page),
      say: opened.message,
      entity: "quote",
      recordId: String(opened.data.record_id),
      reference: String(opened.data.reference),
    } : { kind: "go", route: "", label: "", say: "" })).toEqual(opened.data);
  });

  it("opens the pages Johan named, using the router's own redirects", () => {
    const cases: [string, string][] = [
      ["open leads", "/admin/jobs"],
      ["open quotes", "/admin/quotes"],
      ["open jobs", "/admin/jobs"],
      ["open dispatch", "/admin/jobs"],
      ["open the calendar", "/admin/jobs"],
      ["open clients", "/admin/customers"],
      ["open stock", "/admin/cash-health"],
      ["open reports", "/admin/reports"],
      ["open team", "/admin/team"],
      ["open settings", "/admin/settings"],
      ["open yard view", "/admin/yard"],
    ];
    for (const [said, path] of cases) {
      const parsed = parseNavigateUtterance(said);
      expect(parsed?.kind).toBe("page");
      if (parsed?.kind !== "page") continue;
      const out = resolvePage(parsed.pageId, admin, routes);
      expect(out.kind, said).toBe("go");
      if (out.kind === "go") expect(out.route.split("?")[0], said).toBe(path);
    }
    const stock = resolvePage("stock", admin, routes);
    expect(stock).toMatchObject({ kind: "go", say: "Opening Stock." });
    if (stock.kind === "go") expect(stock.route).toContain("tab=stock");

    const leads = followRedirect("/admin/dispatch?inbox=1", admin, routes);
    const params = new URLSearchParams(leads.split("?")[1]);
    expect(leads.startsWith("/admin/jobs")).toBe(true);
    expect(params.get("inbox")).toBe("1");
    expect(params.get("tab")).toBe("dispatch");
    expect(params.get("view")).toBe("calendar");
  });

  it("offers a pick list when several quotes match and does not navigate", async () => {
    const go = vi.fn();
    const out = await runNavigateTo(
      { utterance: "open Hennie's quote" },
      { actor: admin, routes, search: searchOf(quotes), go },
    );
    expect(go).not.toHaveBeenCalled();
    expect(out.ok).toBe(true);
    expect(out.message).toBe("Several quotes match. Tap one in the chat panel.");
    expect(out.message).not.toMatch(/Hennie/);
    expect(out.choices).toHaveLength(2);
    expect(out.choices?.[0].label).toMatch(/Q-2026-0063/);
    expect(out.choices?.[0].args.record_id).toBe(Q63);

    const picked = await runNavigateTo(out.choices![0].args, { actor: admin, routes, search: searchOf(quotes), go });
    expect(go).toHaveBeenCalledWith(`/admin/estimates/${Q63}`);
    expect(picked.message).toBe("Opening quote Q-2026-0063.");
  });

  it("opens one invoice by number", async () => {
    const go = vi.fn();
    const out = await runNavigateTo(
      { utterance: "show invoice INV-045" },
      { actor: admin, routes, search: searchOf(invoices), go },
    );
    expect(out.message).toBe("Opening invoice INV-045.");
    expect(go).toHaveBeenCalledWith(`/admin/invoices/${INV}`);
  });

  it("ignores a raw address and will not leave the app", async () => {
    const go = vi.fn();
    const out = await runNavigateTo(
      { route: "https://evil.example/admin/settings", utterance: "open https://evil.example" },
      { actor: admin, routes, search: searchOf([]), go },
    );
    expect(go).not.toHaveBeenCalled();
    expect(out.ok).toBe(false);
    expect(out.message).toBe("I can't open that page.");
  });

  it("leaves the last quote and today's jobs to their own tools", () => {
    expect(parseNavigateUtterance("open the last quote")).toBeNull();
    expect(parseNavigateUtterance("show me today's jobs")).toBeNull();
    expect(parseNavigateUtterance("add a Samsung to the lounge")).toBeNull();
  });
});

describe("permission checks", () => {
  it("never sends a sales rep to a page the guard denies", () => {
    for (const id of ["yard", "map", "reports", "stock", "settings", "team", "cash-health"]) {
      const out = resolvePage(id, sales, routes);
      expect(out.kind, id).toBe("deny");
      if (out.kind === "deny") expect(out.say).toMatch(/^You can't open /);
    }
    expect(resolvePage("dashboard", sales, routes)).toMatchObject({ kind: "go", route: "/admin", say: "Opening Dashboard." });
    expect(resolvePage("quotes", sales, routes)).toMatchObject({ kind: "go", route: "/admin/quotes" });
    expect(resolvePage("invoices", sales, routes)).toMatchObject({ kind: "go", route: "/admin/invoices" });
    expect(resolvePage("clients", sales, routes)).toMatchObject({ kind: "go", route: "/admin/customers" });
    expect(resolvePage("leads", sales, routes)).toMatchObject({ kind: "go", route: "/admin/jobs?tab=pipeline", say: "Opening Pipeline." });
    expect(resolvePage("dispatch", sales, routes)).toMatchObject({ kind: "go", route: "/admin/requests", say: "Opening Requests." });
    expect(resolvePage("calendar", sales, routes)).toMatchObject({ kind: "go", route: "/admin/my-appointments", say: "Opening My appointments." });
    expect(roleAllows(matchRoute("/admin/map", routes)!, sales).ok).toBe(false);
    expect(roleAllows(matchRoute("/field", routes)!, sales).ok).toBe(false);
  });

  it("sends a technician to Today and My jobs, and refuses settings, yard and dispatch", () => {
    expect(resolvePage("dashboard", tech, routes)).toMatchObject({ kind: "go", route: "/field", say: "Opening Today." });
    expect(resolvePage("jobs", tech, routes)).toMatchObject({ kind: "go", route: "/admin/my-jobs", say: "Opening My jobs." });
    expect(resolvePage("calendar", tech, routes)).toMatchObject({ kind: "go", route: "/field/schedule" });
    expect(resolvePage("map", tech, routes)).toMatchObject({ kind: "go", route: "/admin/map" });
    for (const id of ["settings", "yard", "team", "dispatch", "leads", "stock", "reports"]) {
      expect(resolvePage(id, tech, routes).kind, id).toBe("deny");
    }
  });

  it("office can open reports and dispatch; a viewer cannot open settings", () => {
    expect(resolvePage("reports", office, routes)).toMatchObject({ kind: "go", route: "/admin/reports" });
    expect(resolvePage("dispatch", office, routes).kind).toBe("go");
    expect(resolvePage("settings", office, routes).kind).toBe("deny");
    expect(resolvePage("settings", viewer, routes).kind).toBe("deny");
    expect(resolvePage("reports", viewer, routes)).toMatchObject({ kind: "go", route: "/admin/reports" });
  });

  it("refuses platform and company-owner pages without that flag", () => {
    const plainAdmin: NavActor = { ...admin, platformOwner: false, companyOwner: false };
    expect(resolvePage("companies", plainAdmin, routes).kind).toBe("deny");
    expect(resolvePage("money", plainAdmin, routes).kind).toBe("deny");
    expect(resolvePage("companies", admin, routes)).toMatchObject({ kind: "go", route: "/admin/companies" });
    expect(resolvePage("money", admin, routes)).toMatchObject({ kind: "go", route: "/admin/money" });
  });

  it("does not navigate while access is still loading", async () => {
    const go = vi.fn();
    const out = await runNavigateTo(
      { utterance: "open invoices" },
      { actor: { ...admin, ready: false }, routes, search: searchOf([]), go },
    );
    expect(go).not.toHaveBeenCalled();
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/still checking/);
  });

  it("a technician's job opens the field sheet, not the admin job page", async () => {
    const jobId = "44444444-4444-4444-8444-444444444444";
    const go = vi.fn();
    const search: NavSearch = {
      search: async () => [{ id: jobId, entity: "job", reference: null, chip: "Install at the house" }],
    };
    const out = await runNavigateTo({ utterance: "open job Install" }, { actor: tech, routes, search, go });
    expect(out.ok).toBe(true);
    expect(go).toHaveBeenCalledWith(`/field/jobs/${jobId}`);
    expect(out.message).toBe("Opening that job.");
  });
});

describe("navigate_to is allowed for every Mandy tier", () => {
  it("is not a system tool and is on the read list", () => {
    expect(isSystemTool("navigate_to")).toBe(false);
    for (const tier of ["admin", "office", "sales", "tech", "viewer"] as const) {
      expect(toolAllowed(tier, "navigate_to")).toBe(true);
    }
    expect(NAVIGATE_RULE).toMatch(/navigate_to/);
    expect(realtimeInstructions({ botName: "Mandy", companyName: "Massair", parent: false, tier: "admin", context: {} })).toMatch(/navigate_to/);
  });
});
