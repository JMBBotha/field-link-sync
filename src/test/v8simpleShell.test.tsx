import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import V8SimpleShell from "@/components/v8simple/V8SimpleShell";
import { v8SimpleChildRoutes } from "@/pages/V8SimpleRoutes";
import { isV8SimpleEnabled, rememberV8Simple, v8SimpleAccess, V8SIMPLE_STORAGE_KEY } from "@/lib/v8simple/flag";
import { V8_SIMPLE_BOOK_JOB, v8SimpleShowsBookJob, v8SimpleTabs } from "@/lib/v8simple/nav";
import { v8SimpleAllPaths } from "@/lib/v8simple/allPages";
import { v8Primary, v8Tabs } from "@/components/v8/v8Nav";

function shell(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/v8" element={<V8SimpleShell root="/v8" />}>
            {v8SimpleChildRoutes()}
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("v8 simple flag", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("stays off unless a preview switch is set", () => {
    expect(isV8SimpleEnabled("")).toBe(false);
    expect(v8SimpleAccess(false)).toBe("redirect-home");
    expect(isV8SimpleEnabled("?v8simple=1")).toBe(true);
    expect(v8SimpleAccess(true)).toBe("open");
    localStorage.setItem(V8SIMPLE_STORAGE_KEY, "1");
    expect(isV8SimpleEnabled("")).toBe(true);
  });

  it("remembers the query so later screens stay in the preview", () => {
    rememberV8Simple("?v8simple=1");
    expect(sessionStorage.getItem(V8SIMPLE_STORAGE_KEY)).toBe("1");
    expect(isV8SimpleEnabled("")).toBe(true);
  });
});

describe("v8 simple shell", () => {
  it("shows only the role tabs, and techs cannot book a sale", () => {
    expect(v8SimpleTabs("tech").map((t) => t.label)).toEqual(["Today", "Schedule", "Me"]);
    expect(v8SimpleTabs("sales").map((t) => t.label)).toEqual(["Home", "Jobs", "Clients", "Schedule"]);
    expect(v8SimpleTabs("admin").map((t) => t.label)).toEqual(["Home", "Jobs", "Schedule", "Clients"]);
    expect(v8SimpleShowsBookJob("tech")).toBe(false);
    expect(v8SimpleShowsBookJob("sales")).toBe(true);
    expect(v8SimpleShowsBookJob("admin")).toBe(true);
    expect(V8_SIMPLE_BOOK_JOB).toBe("/admin/jobs?new=1");
  });

  it("money card counts match the jobs list and the tap opens Money", () => {
    shell("/v8?role=admin");
    expect(screen.getByTestId("v8-simple-shell")).toHaveAttribute("data-role", "admin");
    expect(screen.getByTestId("v8-simple-tabs").textContent).toContain("Home");
    expect(screen.getByTestId("v8-simple-tabs").textContent).not.toContain("Invoices");
    expect(screen.getByTestId("v8-ready-count").textContent).toBe("1");
    expect(screen.getByTestId("v8-money-waiting").getAttribute("href")).toContain("view=money");
    expect(screen.getByTestId("v8-money-waiting").textContent).toMatch(/R30 000/);
    expect(screen.getByTestId("v8-money-waiting").textContent).toMatch(/Collect money/);
    expect(screen.getByTestId("v8-lead-alert").textContent).toMatch(/Southern suburbs/);
    expect(screen.getByTestId("v8-lead-alert").textContent).not.toMatch(/Demo client/);
    expect(screen.queryByTestId("v8-simple-book")).toBeNull();
    expect(document.querySelectorAll("[data-orange='main']")).toHaveLength(1);
    expect(screen.queryByText(/PayFast/i)).toBeNull();
    expect(screen.queryByText(/Massair Ind/i)).toBeNull();
  });

  it("renders a technician shell with no book button and no money", () => {
    shell("/v8?role=tech");
    expect(screen.getByTestId("v8-simple-tabs").textContent).toMatch(/Today/);
    expect(screen.queryByTestId("v8-simple-book")).toBeNull();
    expect(screen.queryByText(/Create lead/i)).toBeNull();
    expect(screen.queryByText(/Book a job/i)).toBeNull();
    expect(screen.getByTestId("v8-simple-home").textContent).toMatch(/no money totals/i);
  });

  it("hides the lead offer until rep offers are switched on", () => {
    shell("/v8?role=sales");
    expect(screen.queryByTestId("v8-lead-offer")).toBeNull();
    expect(screen.getByTestId("v8-quotes-chase").textContent).toMatch(/Demo client C/);
    expect(screen.getByTestId("v8-simple-book")).toBeTruthy();
    cleanup();
    shell("/v8?role=sales&offers=1");
    const offer = screen.getByTestId("v8-lead-offer");
    expect(offer.textContent).toMatch(/Installation/);
    expect(offer.textContent).toMatch(/Southern suburbs/);
    expect(offer.textContent).toMatch(/5:00/);
    expect(offer.textContent).not.toMatch(/Demo client/);
    expect(screen.getByTestId("v8-accept-lead")).toBeTruthy();
    expect(screen.queryByTestId("v8-simple-book")).toBeNull();
  });
});

describe("flag off leaves the live app alone", () => {
  const src = (p: string) => readFileSync(p, "utf8");

  it("does not touch the live navigation files", () => {
    for (const file of [
      "src/components/v8/v8Nav.ts",
      "src/components/v8/V8Sidebar.tsx",
      "src/components/v8/V8BottomNav.tsx",
      "src/components/v8/V8FieldShell.tsx",
      "src/components/admin/AdminLayout.tsx",
      "src/components/FieldAgentBottomNav.tsx",
    ]) {
      expect(src(file)).not.toMatch(/v8simple|v8Simple|V8Simple/);
    }
  });

  it("keeps today's tabs and every staff route", () => {
    expect(v8Tabs("admin").map((l) => l.label)).toEqual(["Home", "Jobs", "Invoices", "Schedule"]);
    expect(v8Tabs("sales").map((l) => l.label)).toEqual(["Home", "Pipeline", "Quotes", "Clients"]);
    expect(v8Primary("tech").map((l) => l.label)).toEqual(["Today", "Schedule", "Earnings"]);
    const app = src("src/App.tsx");
    const kept = [
      'path="/admin"',
      'path="jobs"',
      'path="invoices"',
      'path="quotes"',
      'path="customers"',
      'path="schedule"',
      'path="map"',
      'path="/field"',
      'path="/field/schedule"',
      'path="/field/earnings"',
      'path="/admin/quote-builder"',
    ];
    for (const piece of kept) expect(app).toContain(piece);
    expect(app).toContain('path="/v8"');
    expect(app).toContain("V8SimpleGate");
  });

  it("links every static staff route from admin Settings, and hides money from techs", () => {
    const app = src("src/App.tsx");
    const paths = new Set<string>();
    const admin = app.slice(app.indexOf('path="/admin"'), app.indexOf("{/* Unified Quote Builder"));
    for (const match of admin.matchAll(/path="([^"]+)"/g)) {
      const leaf = match[1];
      if (leaf.includes(":") || leaf.startsWith("/")) continue;
      paths.add(leaf === "" ? "/admin" : `/admin/${leaf}`);
    }
    for (const match of app.matchAll(/path="(\/(?:admin|field)[^"]*)"/g)) {
      if (!match[1].includes(":")) paths.add(match[1]);
    }
    const linked = new Set(v8SimpleAllPaths("admin"));
    const missing = [...paths].filter((p) => !linked.has(p));
    expect(missing).toEqual([]);
    const tech = v8SimpleAllPaths("tech").join(" ");
    expect(tech).not.toMatch(/invoice|earning|money|Book a job|Create lead/i);
    expect(v8SimpleAllPaths("admin").join(" ")).not.toMatch(/PayFast|Massair Ind/i);
  });
});
