// Jobs hub phase 3: Dispatch · Cards renders the lead rail, jobs most urgent first and the tech strip.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const BASE = Date.parse("2026-10-01T12:00:00+02:00");
const at = (h: number) => new Date(BASE + h * 3_600_000).toISOString();
const rows: Record<string, any[]> = {
  jobs: [
    { id: "j1", title: "Install 9kBTU inverter", status: "scheduled", scheduled_for: at(0.5), assignments: [], customers: { name: "Bianca", phone: "0820000001" } },
    { id: "j2", title: "Service 2x split units", status: "dispatched", scheduled_for: at(-0.4), assignments: [{ profile_id: "t1", status: "accepted", profiles: { full_name: "Pieter Nel", phone: "0820000002" } }] },
    { id: "j3", title: "Gas top-up", status: "cancelled", scheduled_for: at(1), assignments: [] },
  ],
  leads: [{ id: "l1", customer_name: "Marissa Ellis", status: "pending", primary_intent: "sales", created_at: at(-1) }],
};
vi.mock("@/integrations/supabase/client", () => {
  const q = (t: string): any => new Proxy(function () {}, { get: (_x, p) => p === "then"
    ? (res: any) => res({ data: rows[t] ?? [], error: null }) : () => q(t) });
  const ch: any = { on: () => ch, subscribe: () => ch };
  return { supabase: { from: q, functions: { invoke: vi.fn() }, channel: () => ch, removeChannel: vi.fn() } };
});
vi.mock("@/contexts/AuthContext", () => { const v = { user: { id: "u1" } }; return { useAuth: () => v }; });
vi.mock("@/components/shared/StatusUndo", () => ({ useUndoAction: () => ({ record: () => null, action: () => undefined }) }));
vi.mock("@/components/leads/LeadCardV2", () => ({ default: ({ lead }: any) => <div data-testid="lead-v2">{lead.customer_name}</div> }));
vi.mock("@/components/jobs/AssignTechDialog", () => ({ default: () => null }));

import DispatchCards from "@/components/jobs/DispatchCards";

describe("DispatchCards", () => {
  it("shows leads, urgent-first jobs (cancelled hidden) and techs", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(BASE);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><DispatchCards /></MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText("Service 2x split units")).toBeTruthy());
    expect(screen.getByTestId("lead-v2").textContent).toBe("Marissa Ellis");
    expect(screen.queryByText("Gas top-up")).toBeNull();
    const cards = Array.from(document.querySelectorAll("[data-dispatch-card]")).map((e) => e.getAttribute("data-dispatch-card"));
    expect(cards).toEqual(["j2", "j1"]);
    expect(screen.getByText(/Late 2\dm/)).toBeTruthy();
    expect(screen.getByText("UNASSIGNED")).toBeTruthy();
    expect(screen.getByText("EN ROUTE")).toBeTruthy();
    expect(screen.getByText(/Assign tech/)).toBeTruthy();
    expect(screen.getByText(/Mark en route|On site/)).toBeTruthy();
    expect(document.querySelectorAll("[data-tech-row]").length).toBe(1);
    vi.useRealTimers();
  });
});
