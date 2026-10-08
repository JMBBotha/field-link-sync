import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state: { ranked: any[]; slots: any[] } = { ranked: [], slots: [] };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(async (name: string) => ({ data: name === "rank_booking_candidates" ? state.ranked : state.slots, error: null })),
  },
}));

import AvailabilityPicker, { statusLabel } from "@/components/scheduling/AvailabilityPicker";

const row = (o: any) => ({ km: null, next_free: null, booked_minutes: 0, work_start: "08:00:00", work_end: "17:00:00", blocks: [], ...o });

function renderPicker(onSelect = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AvailabilityPicker lane="service" date="2026-10-09" startTime="10:00" minutes={120} lat={-33.8} lng={18.7} onSelect={onSelect} />
    </QueryClientProvider>,
  );
  return onSelect;
}

describe("AvailabilityPicker", () => {
  beforeEach(() => {
    state.ranked = [
      row({ profile_id: "a", full_name: "Thabo M", tier: 1, status: "free", km: 2.1, reason: "Already in Durbanville 13:00–16:30 · 2.1 km · free from 17:00",
        blocks: [{ start: "13:00", end: "16:30", label: "Mrs Smith" }] }),
      row({ profile_id: "b", full_name: "Pieter K", tier: 2, status: "free", km: 6.2, reason: "Free · 6.2 km from 08:00 job" }),
      row({ profile_id: "c", full_name: "Sipho N", tier: 3, status: "busy", reason: "Busy 09:00–12:00 · next free 12:30", next_free: "12:30:00",
        blocks: [{ start: "09:00", end: "12:00", label: "Busy" }] }),
      row({ profile_id: "d", full_name: "Anna V", tier: 3, status: "off", reason: "Off today" }),
    ];
    state.slots = [{ profile_id: "a", full_name: "Thabo M", slot_date: "2026-10-09", slot_start: "10:30:00", reason: "x" }];
  });

  it("renders tiers in order with Best match, reasons, chips and km", async () => {
    renderPicker();
    const rows = await screen.findAllByTestId("ranked-person");
    expect(rows).toHaveLength(4);
    expect(rows[0].textContent).toContain("Best match");
    expect(rows[1].textContent).not.toContain("Best match");
    expect(rows[0].textContent).toContain("Already in Durbanville 13:00–16:30");
    expect(rows[0].textContent).toContain("2.1 km");
    expect(rows[2].textContent).toContain("Busy 09:00–12:00");
    expect(rows[2].textContent).toContain("next free 12:30");
    expect(rows[3].textContent).toContain("Off");
    expect(rows[3].textContent).toContain("km ?");
  });

  it("suggested slot tap fills person, date and time", async () => {
    const onSelect = renderPicker();
    const chip = await screen.findByText(/Thabo · Fri 10:30/);
    fireEvent.click(chip);
    expect(onSelect).toHaveBeenCalledWith("a", "2026-10-09", "10:30");
  });

  it("never shows rand amounts or AM/PM", async () => {
    renderPicker();
    await screen.findAllByTestId("ranked-person");
    const text = screen.getByTestId("availability-picker").textContent || "";
    expect(text).not.toMatch(/R\s?\d/);
    expect(text).not.toMatch(/\b(AM|PM)\b/i);
  });

  it("salesperson caller: only own row, others' bookings as Busy", async () => {
    state.ranked = [row({ profile_id: "me", full_name: "Lisa S", tier: 2, status: "free", reason: "Free",
      blocks: [{ start: "08:00", end: "09:00", label: "Busy" }] })];
    state.slots = [];
    renderPicker();
    await waitFor(() => expect(screen.getAllByTestId("ranked-person")).toHaveLength(1));
    const html = screen.getByTestId("availability-picker").innerHTML;
    expect(html).toContain("Busy 08:00–09:00");
    expect(html).not.toContain("Mrs Smith");
  });

  it("statusLabel maps statuses", () => {
    expect(statusLabel({ status: "leave", reason: "", blocks: [] })).toBe("On leave");
    expect(statusLabel({ status: "busy", reason: "Busy 14:00–18:00 · next free 18:30", blocks: [] })).toBe("Busy 14:00–18:00");
    expect(statusLabel({ status: "free", reason: "", blocks: [] })).toBe("Free");
  });
});
