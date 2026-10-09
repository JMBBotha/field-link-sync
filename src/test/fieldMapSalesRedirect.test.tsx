import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const salesState = { isSalesRep: false, loading: false };
vi.mock("@/hooks/useSalesRep", () => ({ useSalesRep: () => salesState }));
import SalesRepFieldRedirect, { salesHomeFor } from "@/components/SalesRepFieldRedirect";

const src = (p: string) => readFileSync(p, "utf8");

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/field" element={<SalesRepFieldRedirect><div>TECH FIELD</div></SalesRepFieldRedirect>} />
        <Route path="/field/quote-builder" element={<SalesRepFieldRedirect><div>AGENT QB</div></SalesRepFieldRedirect>} />
        <Route path="/admin/visits" element={<div>MY VISITS</div>} />
        <Route path="/admin/quote-builder" element={<div>ADMIN QB</div>} />
      </Routes>
    </MemoryRouter>,
  );

describe("Sales reps don't use /field (Johan 18:58)", () => {
  it("sends a sales rep from /field to My visits", () => {
    salesState.isSalesRep = true;
    renderAt("/field");
    expect(screen.getByText("MY VISITS")).toBeTruthy();
  });
  it("sends a sales rep from /field/quote-builder to the same unified builder in the admin layout", () => {
    salesState.isSalesRep = true;
    renderAt("/field/quote-builder?leadId=x");
    expect(screen.getByText("ADMIN QB")).toBeTruthy();
    expect(salesHomeFor("/field/quote-builder", "?leadId=x")).toBe("/admin/quote-builder?leadId=x");
  });
  it("leaves technicians/admins on /field", () => {
    salesState.isSalesRep = false;
    renderAt("/field");
    expect(screen.getByText("TECH FIELD")).toBeTruthy();
  });
  it("wraps every sales-reachable /field route in App", () => {
    const app = src("src/App.tsx");
    for (const r of ["/field", "/field/quote-builder", "/field/my-jobs", "/field/my-base", "/field/schedule"]) {
      expect(app).toMatch(new RegExp(`path="${r}" element=\\{<SalesRepFieldRedirect>`));
    }
  });
  it("hides the 'Field Agent View' link for sales reps and sends office roles to /admin from /", () => {
    expect(src("src/components/admin/AdminSidebar.tsx")).toMatch(/isSalesRep \? \[\] : \[\{ path: "\/field", label: "Field Agent View"/);
    expect(src("src/pages/Index.tsx")).toMatch(/\["admin", "dispatcher", "viewer"\]\.includes\(r\.role\)/);
  });
  it("keeps Accept and adds Release in the sales layout (visit detail)", () => {
    const v = src("src/pages/admin/AdminVisitsPage.tsx");
    expect(v).toContain('data-testid="visit-accept"');
    expect(v).toContain('data-testid="visit-release"');
    expect(v).toMatch(/\.update\(\{ status: "pending", assigned_agent_id: null, accepted_at: null \}/);
    expect(v).toMatch(/\.eq\("assigned_agent_id", user\.id\)/);
  });
});

describe("/field map is never a blank box (Johan 18:58)", () => {
  const fa = src("src/pages/FieldAgent.tsx");
  it("pins the map container with inline styles (mapbox-gl.css .mapboxgl-map{position:relative} collapsed it to 0px)", () => {
    expect(fa).toMatch(/ref=\{mapRef\}[^>]*style=\{\{ position: "absolute", inset: 0 \}\}/);
    expect(src("src/components/map/LeadHeatmap.tsx")).toMatch(/style=\{\{ position: "absolute", inset: 0 \}\}/);
  });
  it("shows clear messages instead of blank/forever-loading", () => {
    expect(fa).toContain("Allow location to see the map");
    expect(fa).toContain("Map unavailable");
    expect(fa).toMatch(/setMapError\("The map key could not be loaded\."\)/);
    expect(fa).toMatch(/took too long to load/);
    expect(fa).toMatch(/setLocationError\(error\?\.code === 1 \? "denied" : "unavailable"\)/);
  });
});
