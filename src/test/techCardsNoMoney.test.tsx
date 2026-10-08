import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "tech" } }) }));
vi.mock("@/hooks/useLeadSla", () => ({ useNow: () => new Date("2026-10-08T12:00:00+02:00"), useLeadSla: () => ({ sla: {} }), logLeadContact: vi.fn() }));
vi.mock("@/hooks/useLaneStaff", () => ({ useLaneStaff: () => ({ staff: [], salesStaff: [], technicians: [] }) }));
vi.mock("@/hooks/useLeadPhotoCount", () => ({ useSingleLeadPhotoCount: () => ({ count: 2 }) }));
import FieldAgentLeadCard from "@/components/FieldAgentLeadCard";
import JobCard from "@/components/cards/JobCard";
import { assignmentToCard, scheduleRowToCard } from "@/lib/cardModel";
import DepositPaymentChip from "@/components/shared/DepositPaymentChip";
import { Button } from "@/components/ui/button";

const invoice = { id: "i", grand_total: 1000, amount_paid: 300, remaining: 700 };
const assignment = { status: "accepted", job_id: "j", job_type: "installation", jobs: {
  id: "j", title: "Installation R 1000", address: "Main Road", scheduled_for: "2026-10-09T14:00:00+02:00",
  customers: { name: "Client" } } };

describe("C3 technician cards", () => {
  it("active lead keeps actions, booked time, job sheet and a money-free part-paid chip", () => {
    const start = vi.fn(), open = vi.fn();
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>
      <FieldAgentLeadCard variant="active" lead={{ id: "l", customer_name: "Client R 950", customer_phone: "0820000000",
        customer_address: "Main Road", service_type: "installation", status: "accepted", latitude: 0, longitude: 0,
        assigned_agent_id: "tech", scheduled_date: "2099-10-09", scheduled_time: "14:00:00" }}
        invoice={invoice} estimateUrl="/field/jobs/j" onCardClick={open} onStart={start} />
    </MemoryRouter></QueryClientProvider>);
    expect(screen.getByText("Part paid · balance due")).toBeTruthy();
    expect(screen.getByText("You")).toBeTruthy();
    expect(screen.getByText("Open job sheet").closest("a")?.getAttribute("href")).toBe("/field/jobs/j");
    fireEvent.click(screen.getByRole("button", { name: "Start Job" }));
    expect(start).toHaveBeenCalledTimes(1); expect(open).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/R\s?\d/);
    expect(screen.queryByText("Assign")).toBeNull();
  });

  it("assigned-job and schedule cards keep technician actions and hide money and office controls", () => {
    const accept = vi.fn();
    const row = { job_id: "s", job_title: "Service R 200", job_type: "service", assignment_status: "accepted",
      job_scheduled_for: "2026-10-09T14:00:00+02:00", customer_name: "Client R500" };
    render(<MemoryRouter>
      <JobCard item={assignmentToCard(assignment)} audience="tech" density="full" onOpen={vi.fn()}
        actions={<><DepositPaymentChip invoice={invoice} hideAmount /><Button onClick={accept}>Accept</Button>
          <Button>Reject</Button><Button>Start</Button><Button>Complete</Button><Button>Job sheet</Button>
          <span>Offline — actions will queue</span><Button>Assign</Button><Button>Auto</Button><a href="/quote/q">Client</a></>} />
      <JobCard item={scheduleRowToCard(row)} audience="tech" density="full" onOpen={vi.fn()}
        actions={<DepositPaymentChip invoice={invoice} hideAmount />} />
    </MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Accept" })); expect(accept).toHaveBeenCalledTimes(1);
    for (const name of ["Reject", "Start", "Complete", "Job sheet"]) expect(screen.getByRole("button", { name })).toBeTruthy();
    expect(screen.getByText(/Offline/)).toBeTruthy();
    expect(screen.getAllByText("14:00")).toHaveLength(2);
    expect(document.body.textContent).not.toMatch(/R\s?\d|Assign|Auto|Client links/);
    expect(screen.queryByRole("link", { name: "Client" })).toBeNull();
  });

  it("calendar visits keep their visit shape and normalised HH:MM time", () => {
    const item = scheduleRowToCard({ key: "lead:l", lead_id: "l", job_id: null, date: "2026-10-09",
      start_time: "14:00:00", agent_id: "tech", primary_intent: "service", customer_name: "Visit R100", status: "accepted" });
    render(<JobCard item={item} audience="tech" density="compact" onOpen={vi.fn()} />);
    expect(item.kind).toBe("visit"); expect(screen.getByText("14:00")).toBeTruthy();
    expect(screen.getByText("SERVICE")).toBeTruthy(); expect(document.body.textContent).not.toMatch(/R\s?\d/);
  });

  it("all technician deposit surfaces opt out of amounts", () => {
    for (const path of ["src/components/FieldAgentLeadCard.tsx", "src/pages/FieldSchedulePage.tsx", "src/pages/admin/AdminMyJobsPage.tsx"])
      expect(readFileSync(path, "utf8")).toMatch(/hideAmount/);
  });
});