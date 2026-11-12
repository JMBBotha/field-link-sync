import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { SalesHomeScreen, TechHomeScreen } from "@/components/v8/roleHome/screens";
import { SALES_HOME_ROUTES } from "@/lib/roleHome";
import { salesHomeTiles } from "@/lib/salesHomeTiles";
import { v8Primary } from "@/components/v8/v8Nav";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const EMPTY_TILES = salesHomeTiles({ earned: 0, pending: 0, followUps: 0, jobsToday: 0, drafts: 0 });
const DEMO_TILES = salesHomeTiles({ earned: 1840, pending: 620, followUps: 3, jobsToday: 2, drafts: 4 });

function Probe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname}{loc.search}</div>;
}

describe("sales home layout", () => {
  it("uses a slim greeting and two compact empty states with the existing sales routes", () => {
    render(
      <MemoryRouter>
        <SalesHomeScreen eyebrow="WEDNESDAY, 11 NOV" title="Good evening, Demo" appointments={[]} booked={[]} tiles={EMPTY_TILES} />
        <Probe />
      </MemoryRouter>,
    );
    const greet = screen.getByTestId("role-greeting");
    expect(greet.tagName).toBe("HEADER");
    expect(greet.className).toContain("rh-sales-greet");
    expect(greet.className).not.toContain("rh-intro");
    expect(greet).toHaveTextContent("WEDNESDAY, 11 NOV");
    expect(greet).toHaveTextContent("Good evening, Demo");
    expect(screen.getByTestId("role-sales-home").className).toContain("rh-sales");
    expect(document.querySelector(".rh-sales-pair")).toBeTruthy();
    expect(screen.getByTestId("sales-appointments")).toHaveTextContent("Nothing on your calendar today.");
    expect(screen.getByTestId("sales-booked")).toHaveTextContent("No jobs under your name yet.");
    expect(screen.getByTestId("sales-open-schedule")).toHaveAttribute("href", SALES_HOME_ROUTES.schedule);
    expect(screen.getByTestId("sales-open-pipeline")).toHaveAttribute("href", SALES_HOME_ROUTES.pipeline);
    const kpis = screen.getByTestId("sales-kpis");
    expect(kpis.firstElementChild).toHaveAttribute("data-testid", "sales-kpi-commission");
    expect(screen.getByTestId("sales-kpi-commission")).toHaveTextContent("R 0,00");
    expect(screen.getByTestId("sales-kpi-commission").querySelector("a")).toHaveAttribute("href", SALES_HOME_ROUTES.commission);
    expect(screen.getByTestId("sales-kpi-followups").querySelector("a")).toHaveAttribute("href", SALES_HOME_ROUTES.followUps);
    expect(screen.getByTestId("sales-kpi-today").querySelector("a")).toHaveAttribute("href", SALES_HOME_ROUTES.schedule);
    expect(screen.getByTestId("sales-kpi-drafts").querySelector("a")).toHaveAttribute("href", SALES_HOME_ROUTES.drafts);
    expect(v8Primary("sales").some((l) => l.path === SALES_HOME_ROUTES.schedule && l.label === "Schedule")).toBe(true);
    expect(v8Primary("sales").some((l) => l.path === SALES_HOME_ROUTES.pipeline && l.label === "Pipeline")).toBe(true);
    fireEvent.click(screen.getByTestId("sales-open-schedule"));
    expect(screen.getByTestId("loc")).toHaveTextContent("/admin/schedule");
    fireEvent.click(screen.getByTestId("sales-open-pipeline"));
    expect(screen.getByTestId("loc")).toHaveTextContent("/admin/jobs?tab=pipeline");
  });

  it("shows time, client, area and status from the fields the cards already have", () => {
    render(
      <MemoryRouter>
        <SalesHomeScreen
          eyebrow="SATURDAY, 07 NOV"
          title="Good morning, Demo"
          appointments={[
            { id: "1", href: "/admin/dispatch?lead=demo-1", time: "09:00", type: "Quote visit", place: "Newlands · Demo Client 4", client: "Demo Client 4", area: "Newlands", chip: { label: "No technician yet", tone: "neutral" } },
            { id: "2", href: "/admin/dispatch?lead=demo-2", time: "14:00", type: "Follow-up", place: "Rondebosch · Demo Client 3", chip: null },
          ]}
          booked={[
            { id: "j1", href: "/admin/jobs/demo-7", when: "Tue 12:00", type: "Installation", client: "Demo Client 7", area: "Claremont", tech: "Tech A", status: "Assigned" },
            { id: "j2", href: "/admin/jobs/demo-4", when: "Fri", type: "Service", client: "Demo Client 4", area: "Observatory", tech: null },
          ]}
          tiles={DEMO_TILES}
        />
      </MemoryRouter>,
    );
    const first = screen.getAllByTestId("sales-appointment")[0];
    expect(first).toHaveAttribute("href", "/admin/dispatch?lead=demo-1");
    expect(first).toHaveTextContent("09:00");
    expect(first).toHaveTextContent("Quote visit");
    expect(first).toHaveTextContent("Demo Client 4");
    expect(first).toHaveTextContent("Newlands");
    expect(first).toHaveTextContent("No technician yet");
    const second = screen.getAllByTestId("sales-appointment")[1];
    expect(second).toHaveTextContent("14:00");
    expect(second).toHaveTextContent("Demo Client 3");
    expect(second).toHaveTextContent("Rondebosch");
    expect(second).toHaveTextContent("Follow-up");
    const booked = screen.getAllByTestId("sales-booked-job");
    expect(booked[0]).toHaveTextContent("Tue 12:00");
    expect(booked[0]).toHaveTextContent("Demo Client 7");
    expect(booked[0]).toHaveTextContent("Claremont");
    expect(booked[0]).toHaveTextContent("Assigned · Tech A");
    expect(booked[1]).toHaveTextContent("No technician yet");
    expect(screen.getByTestId("sales-kpi-commission")).toHaveTextContent("R 1 840,00");
    expect(screen.getByTestId("sales-kpi-commission")).toHaveTextContent("R 620,00 pending");
    expect(screen.getByTestId("sales-kpi-followups")).toHaveTextContent("3");
    expect(screen.queryByTestId("sales-open-schedule")).toBeNull();
    expect(screen.queryByTestId("sales-open-pipeline")).toBeNull();
  });

  it("leaves the tech greeting card and the other roles' earlier-detail bar alone", () => {
    render(<MemoryRouter><TechHomeScreen eyebrow="SATURDAY, 07 NOV" title="Good morning, Tech A" jobs={[]} /></MemoryRouter>);
    expect(screen.getByTestId("role-greeting").className).toContain("rh-intro");
    expect(screen.getByTestId("role-tech-home")).toBeInTheDocument();
    expect(screen.queryByTestId("role-sales-home")).toBeNull();
    const page = readFileSync("src/pages/admin/AdminHomePage.tsx", "utf8");
    const css = readFileSync("src/components/v8/roleHome/roleHome.css", "utf8");
    const live = readFileSync("src/components/v8/roleHome/LiveHomes.tsx", "utf8");
    const tech = readFileSync("src/components/v8/roleHome/screens.tsx", "utf8");
    expect(page).toContain('v8Role === "sales" ? "rh-sales-earlier" : "rounded-2xl border bg-card/95 p-2"');
    expect(page).toContain("home-earlier-detail");
    expect(css).toContain(".rh-sales,\n.rh-sales-earlier { width: 920px; max-width: 100%; }");
    expect(css).toContain(".rh-sales-kpis");
    expect(css).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
    expect(css).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(css).toContain("grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)");
    expect(css).toContain("@media (max-width: 700px)");
    expect(css).toContain("@media (min-width: 1280px)");
    expect(css).toContain(".rh-sales,\n  .rh-sales-earlier { margin-left: auto; margin-right: auto; }");
    expect(css).toContain(".rh-sales .rh-frost");
    expect(css).toContain("rgba(255, 255, 255, .64)");
    const harness = readFileSync("src/pages/RoleHomeHarness.tsx", "utf8");
    expect(harness).toContain('map={sp.get("map") === "1" || salesBoard}');
    expect(harness).toContain("const salesBoard = view === \"sales-home\"");
    expect(live).toContain('supabase.rpc("sales_my_jobs"');
    expect(live).toContain("useMyAppointments(14)");
    expect(tech).toContain("<IntroCard eyebrow={eyebrow} title={title} />");
    expect(tech).toContain('data-testid="role-admin-home"');
  });
});
