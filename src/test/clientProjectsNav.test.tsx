import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { useState } from "react";
import { readFileSync } from "fs";
import ClientSectionNav from "@/components/customers/ClientSectionNav";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { applyClientSection, clientProjectDestination, useClientSectionSelect, type ClientProjectRef } from "@/lib/clientProjectsNav";
import ProjectsList from "@/components/projects/ProjectsList";

const avec = { id: "p-avec", customer_id: "avec", company_id: "massair" };
const otherClient = { id: "p-other", customer_id: "someone-else", company_id: "massair" };
const otherCompany = { id: "p-foreign", customer_id: "avec", company_id: "other-co" };

function Loc() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname}{loc.search}</div>;
}

function Probe({ projects, ready = true }: { projects: ClientProjectRef[]; ready?: boolean }) {
  const [tab, setTab] = useState("activity");
  const select = useClientSectionSelect({ customerId: "avec", companyId: "massair", projects, ready, setTab });
  return (
    <>
      <Loc />
      <ClientSectionNav
        chips={[
          { key: "activity", label: "Activity", weight: "quiet" },
          { key: "projects", label: "Projects", weight: "heavy", cue: "119 houses" },
        ]}
        active={tab}
        onSelect={select}
        more={[]}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsContent value="activity"><p>Activity body</p></TabsContent>
        <TabsContent value="projects"><div id="client-projects">This client's projects</div></TabsContent>
      </Tabs>
    </>
  );
}

function tap(el: HTMLElement, pointerType: "mouse" | "touch") {
  fireEvent.pointerDown(el, { pointerType, button: 0 });
  fireEvent.pointerUp(el, { pointerType, button: 0 });
  fireEvent.click(el);
}

describe("client project destination", () => {
  it("opens this client's only project and ignores another client or company", () => {
    expect(clientProjectDestination("avec", [otherClient, avec, otherCompany], "massair")).toEqual({
      kind: "phases", projectId: "p-avec", href: "/admin/projects/p-avec",
    });
    expect(clientProjectDestination("avec", [otherClient], "massair").kind).toBe("list");
    expect(clientProjectDestination("avec", [otherCompany], "massair").kind).toBe("list");
    expect(clientProjectDestination("avec", [avec, { id: "p2", customer_id: "avec", company_id: "massair" }], "massair").kind).toBe("list");
  });

  it("does not navigate while the client's projects are still loading", () => {
    const navigate = vi.fn();
    const setTab = vi.fn();
    expect(applyClientSection("projects", { customerId: "avec", companyId: "massair", projects: [] }, { navigate, setTab }, { projectsReady: false })).toBe("wait");
    expect(navigate).not.toHaveBeenCalled();
    expect(setTab).not.toHaveBeenCalled();
  });
});

describe("Projects chip click", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  function renderAt(projects: ClientProjectRef[], ready = true) {
    return render(
      <MemoryRouter initialEntries={["/admin/customers/avec"]}>
        <Probe projects={projects} ready={ready} />
      </MemoryRouter>,
    );
  }

  it("desktop click opens this developer's house phases", () => {
    renderAt([otherClient, avec]);
    tap(screen.getByTestId("client-tab-projects"), "mouse");
    expect(screen.getByTestId("loc")).toHaveTextContent("/admin/projects/p-avec");
    expect(screen.getByTestId("loc").textContent).not.toContain("p-other");
  });

  it("touch click opens the same phases", () => {
    renderAt([avec]);
    const btn = screen.getByTestId("client-tab-projects");
    expect(btn.className).toContain("touch-manipulation");
    tap(btn, "touch");
    expect(screen.getByTestId("loc")).toHaveTextContent("/admin/projects/p-avec");
  });

  it("with two of this client's projects, shows this client's list and does not guess", async () => {
    renderAt([
      { id: "p1", customer_id: "avec", company_id: "massair" },
      { id: "p2", customer_id: "avec", company_id: "massair" },
    ]);
    tap(screen.getByTestId("client-tab-projects"), "mouse");
    expect(screen.getByTestId("loc")).toHaveTextContent("/admin/customers/avec");
    expect(screen.getByText("This client's projects")).toBeInTheDocument();
    await waitFor(() => expect(document.getElementById("client-projects")).toHaveAttribute("data-revealed", "true"));
  });

  it("other chips still switch tabs", () => {
    renderAt([avec]);
    fireEvent.click(screen.getByTestId("client-tab-activity"));
    expect(screen.getByText("Activity body")).toBeInTheDocument();
    expect(screen.getByTestId("loc")).toHaveTextContent("/admin/customers/avec");
  });

  it("navigates once the client's project finishes loading", async () => {
    function Host({ ready, projects }: { ready: boolean; projects: ClientProjectRef[] }) {
      return (
        <MemoryRouter initialEntries={["/admin/customers/avec"]}>
          <Probe projects={projects} ready={ready} />
        </MemoryRouter>
      );
    }
    const { rerender } = render(<Host ready={false} projects={[]} />);
    tap(screen.getByTestId("client-tab-projects"), "touch");
    expect(screen.getByTestId("loc")).toHaveTextContent("/admin/customers/avec");
    rerender(<Host ready projects={[avec]} />);
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent("/admin/projects/p-avec"));
  });
});

vi.mock("@/hooks/useProjectTracker", () => ({
  useProjects: (customerId?: string, _enabled?: boolean, companyId?: string | null) => ({
    data: [
      { id: "p-avec", customer_id: "avec", company_id: "massair", name: "AVEC", status: "active", po_number: null, project_houses: [{ count: 119 }], customers: null },
      { id: "p-other", customer_id: "someone-else", company_id: "massair", name: "Other estate", status: "active", po_number: null, project_houses: [{ count: 3 }], customers: null },
    ].filter((p) => (!customerId || p.customer_id === customerId) && (!companyId || p.company_id === companyId)),
    isLoading: false,
    isFetched: true,
    isError: false,
  }),
  useInvalidateProject: () => () => {},
  clientName: () => "AVEC",
  db: {},
}));

describe("project card on the client", () => {
  it("links to this client's phases, not the other development", () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<ProjectsList customerId="avec" companyId="massair" />} />
          <Route path="/admin/projects/:projectId" element={<Loc />} />
        </Routes>
      </MemoryRouter>,
    );
    const links = screen.getAllByTestId("project-open");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/admin/projects/p-avec");
    expect(links[0]).toHaveAttribute("data-project-id", "p-avec");
    fireEvent.click(links[0]);
  });
});

describe("page wiring", () => {
  it("the client record uses the scoped Projects click, and the query filters client and company", () => {
    const page = readFileSync("src/pages/admin/AdminCustomerDetailPage.tsx", "utf8");
    expect(page).toContain("useClientSectionSelect");
    expect(page).toContain('id="client-projects"');
    expect(page).not.toContain("onSelect={setInnerTab}");
    const hook = readFileSync("src/hooks/useProjectTracker.ts", "utf8");
    expect(hook).toContain('q.eq("customer_id", customerId)');
    expect(hook).toContain('q.eq("company_id", companyId)');
  });
});
