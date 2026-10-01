// Jobs hub phase 2: the quote pipeline renders stages, values, flags and filters from mocked rows.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
vi.mock("@/integrations/supabase/client", () => {
  const q = (t: string): any => new Proxy(function () {}, { get: (_x, p) => p === "then"
    ? (res: any) => res({ data: rows[t] ?? [], error: null }) : () => q(t) });
  return { supabase: { from: q, rpc: () => Promise.resolve({ data: null, error: null }) } };
});
vi.mock("@/contexts/AuthContext", () => { const v = { user: { id: "r1" }, session: {}, loading: false }; return { useAuth: () => v }; });
vi.mock("@/hooks/useRole", () => { const v = { roles: ["admin"], isAdmin: true, loading: false }; return { useRole: () => v }; });
vi.mock("@/components/quoting/useQuoteStaffActions", () => ({ useQuoteStaffActions: () => ({ itemsFor: () => [], dialogs: null }) }));
vi.mock("@/components/quoting/AcceptedWorkSection", () => ({ default: () => <div data-testid="accepted-work" /> }));

import PipelineBoard from "@/components/jobs/PipelineBoard";

const mount = (view: "cards" | "stages") => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><PipelineBoard view={view} /></MemoryRouter>
  </QueryClientProvider>,
);

describe("PipelineBoard", () => {
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
  });
});
