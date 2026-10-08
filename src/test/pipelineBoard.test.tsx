// Jobs hub phase 2: the quote pipeline renders stages, values, flags and filters from mocked rows.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rows: Record<string, any[]> = {
  quotes: [
    { id: "q1", company_id: "c", status: "accepted", total: 20879, created_at: "2026-03-04T08:00:00Z", accepted_at: "2026-07-30T08:00:00Z", sales_engineer_id: "r1", quote_number: "Q-2026-0019", customers: { name: "Brendon Behnke", area: "Val De Vie", city: null } },
    { id: "q2", company_id: "c", status: "sent", total: 144319, created_at: "2026-07-05T08:00:00Z", sent_at: "2026-07-05T08:00:00Z", valid_until: "2026-08-04", sales_engineer_id: "r1", quote_number: "Q-2026-0020", customers: { name: "Bianca", area: "Gordons Bay", city: null } },
    { id: "q3", company_id: "c", status: "draft", total: 26758, created_at: "2026-09-18T08:00:00Z", sales_engineer_id: "r1", quote_number: "Q-2026-0012", customer_name: "Test Dummy Lead QA" },
  ],
  invoices: [{ quote_id: "q1", status: "paid", notes: null, grand_total: 20879 }],
  jobs: [],
  leads: [{ id: "l1", customer_name: "Marissa Ellis", customer_address: "Milnerton, Cape Town", primary_intent: "sales", service_type: null, created_at: "2026-09-01T08:00:00Z", first_contact_at: null }],
  profiles: [{ id: "r1", full_name: "Johan Botha" }],
};
const actions = vi.hoisted(() => ({ accept: vi.fn(), decline: vi.fn(), isSalesRep: false }));
vi.mock("@/integrations/supabase/client", () => {
  const q = (t: string): any => new Proxy(function () {}, { get: (_x, p) => p === "then"
    ? (res: any) => res({ data: rows[t] ?? [], error: null }) : () => q(t) });
  return { supabase: { from: q, rpc: () => Promise.resolve({ data: null, error: null }) } };
});
vi.mock("@/contexts/AuthContext", () => { const v = { user: { id: "r1" }, session: {}, loading: false }; return { useAuth: () => v }; });
vi.mock("@/hooks/useRole", () => { const v = { roles: ["admin"], isAdmin: true, loading: false }; return { useRole: () => v }; });
vi.mock("@/hooks/useSalesRep", () => ({ useSalesRep: () => ({ isSalesRep: actions.isSalesRep, loading: false }) }));
vi.mock("@/components/leads/LeadCardV2", () => ({ default: ({ lead, density, onOpen, action }: any) => <div data-testid="lead-v2" data-density={density} onClick={onOpen}>{lead.customer_name}<span>no quote yet</span><div onClick={(e) => e.stopPropagation()}>{action}</div></div> }));
vi.mock("@/components/quoting/useQuoteStaffActions", () => ({ useQuoteStaffActions: () => ({ itemsFor: () => [
  { label: "Mark accepted", onSelect: actions.accept }, { label: "Mark declined", onSelect: actions.decline },
], dialogs: null }) }));
vi.mock("@/components/quoting/AcceptedWorkSection", () => ({ default: () => <div data-testid="accepted-work" /> }));

import PipelineBoard from "@/components/jobs/PipelineBoard";

const mount = (view: "cards" | "stages") => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><PipelineBoard view={view} /></MemoryRouter>
  </QueryClientProvider>,
);

describe("PipelineBoard", () => {
  afterEach(() => { rows.quotes = rows.quotes.filter((q) => !q.id.startsWith("extra")); actions.isSalesRep = false; vi.clearAllMocks(); });
  it("shows stage columns, values, flags and hides test records", async () => {
    localStorage.removeItem("fls.pipeline.hideTest");
    mount("stages");
    await waitFor(() => expect(screen.getByText("Brendon Behnke")).toBeTruthy());
    expect(screen.getByText("Accepted · deposit")).toBeTruthy();
    expect(screen.getByText("Bianca")).toBeTruthy();
    expect(screen.queryByText("Test Dummy Lead QA")).toBeNull();
    expect(screen.getByText("Marissa Ellis")).toBeTruthy();
    expect(screen.getByText("PAID · NO JOB")).toBeTruthy();
    expect(screen.getByText("EXPIRED")).toBeTruthy();
    expect(document.querySelectorAll("[data-rep-initials]").length).toBe(0);
    expect(screen.getAllByText(/Book job/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText(/deposits paid · no job booked/));
    expect(screen.queryByText("Bianca")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /Book job/ })[0]);
    await waitFor(() => expect(screen.getByTestId("accepted-work")).toBeTruthy());
  });

  it("cards view lists follow-ups by value x days", async () => {
    mount("cards");
    await waitFor(() => expect(screen.getByText(/Bianca/)).toBeTruthy());
    expect(screen.getByText("Follow up")).toBeTruthy();
    expect(screen.getByText(/no quote yet/)).toBeTruthy();
    expect(screen.getByTestId("lead-v2").getAttribute("data-density")).toBe("compact");
    expect(document.querySelectorAll("[data-deal-card]").length).toBe(2);
  });

  it("shows at most two cards per collapsed block and expands/collapses from both controls", async () => {
    rows.quotes.push(...[1, 2, 3, 4].map((n) => ({ id: `extra${n}`, status: "draft", total: n * 1000, created_at: "2026-10-01T08:00:00Z", customer_name: `Extra client ${n}` })));
    mount("stages");
    await waitFor(() => expect(screen.getByText("Extra client 4")).toBeTruthy());
    const block = document.querySelector('[data-stage-block="draft"]');
    if (!block) throw new Error("Missing draft block");
    expect(block.querySelectorAll("[data-deal-card]").length).toBe(2);
    fireEvent.click(within(block as HTMLElement).getByRole("button", { name: "+2 more" }));
    expect(block.querySelectorAll("[data-deal-card]").length).toBe(4);
    expect(block.className).toContain("col-span-full");
    const header = within(block as HTMLElement).getByRole("button", { name: "Draft stage" });
    expect(header.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(header);
    expect(block.querySelectorAll("[data-deal-card]").length).toBe(2);
    expect(header.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(header);
    expect(block.querySelectorAll("[data-deal-card]").length).toBe(4);
  });

  it("drops onto collapsed accepted, booked and hidden Lost blocks using the existing actions", async () => {
    mount("stages");
    await waitFor(() => expect(screen.getByText("Bianca")).toBeTruthy());
    const card = screen.getByText("Bianca").closest("[data-deal-card]");
    const accepted = document.querySelector('[data-stage-block="accepted"]');
    const lost = document.querySelector('[data-stage-block="lost"]');
    if (!card || !accepted || !lost) throw new Error("Missing drop fixtures");
    const dataTransfer = { setData: vi.fn() };
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(accepted, { dataTransfer });
    expect(accepted.className).toContain("ring-2");
    fireEvent.drop(accepted, { dataTransfer });
    expect(actions.accept).toHaveBeenCalledOnce();
    fireEvent.dragEnd(card);
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(lost, { dataTransfer });
    fireEvent.drop(lost, { dataTransfer });
    expect(actions.decline).toHaveBeenCalledOnce();
    fireEvent.dragEnd(card);
    const acceptedCard = screen.getByText("Brendon Behnke").closest("[data-deal-card]");
    const booked = document.querySelector('[data-stage-block="booked"]');
    if (!acceptedCard || !booked) throw new Error("Missing booking fixtures");
    fireEvent.dragStart(acceptedCard, { dataTransfer });
    fireEvent.drop(booked, { dataTransfer });
    await waitFor(() => expect(screen.getByTestId("accepted-work")).toBeTruthy());
  });

  it("hides card rep initials for sales reps but keeps admin per-rep totals", async () => {
    actions.isSalesRep = true;
    mount("cards");
    await waitFor(() => expect(screen.getByText("Bianca")).toBeTruthy());
    expect(document.querySelectorAll("[data-rep-initials]").length).toBe(0);
    expect(screen.getByText("Johan Botha")).toBeTruthy();
  });
});
