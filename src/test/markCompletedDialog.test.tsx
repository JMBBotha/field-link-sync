import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const toast = vi.fn();
const rpc = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) },
}));

import { MarkCompletedDialog, type CompleteFixtures } from "@/components/jobs/JobAdminStatusDialogs";

const install: CompleteFixtures = {
  kind: "installation",
  visits: [
    { id: "old-1", date: "2026-11-03", start: "14:00", end: "17:00" },
    { id: "old-2", date: "2026-11-04", start: "12:00", end: "14:00" },
  ],
  quote: [
    { key: "u", item: "Indoor cassette", qty: 1, unit: null, code: "FTXM35", kind: "unit" },
    { key: "cu", item: "Copper pipe", qty: 15, unit: "m", stockItemId: "s-cu", quoteItemId: "qi-cu", kind: "material" },
  ],
  booked: [{ id: "m1", source: "used", item: "Copper pipe", qty: 6, unit: "m", drawnQty: 6, stockItemId: "s-cu", quoteItemId: "qi-cu" }],
};

function renderDialog(props: Partial<Parameters<typeof MarkCompletedDialog>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MarkCompletedDialog jobId="job-1" open onOpenChange={() => {}} suggestedAt="2026-11-03T09:00:00Z" fixtures={install} {...props} />
    </QueryClientProvider>,
  );
}

describe("Mark completed dialog", () => {
  beforeEach(() => {
    toast.mockReset();
    rpc.mockReset();
    rpc.mockResolvedValue({ data: { ok: true, clashes: [] }, error: null });
  });

  it("shows the booked days and both choices, and does not save until one is picked", () => {
    renderDialog({ seedVisits: [{ date: "2026-11-01", start: "08:00", end: "12:00" }, { date: "2026-11-02", start: "08:00", end: "16:00" }] });
    expect(screen.getByTestId("existing-bookings").textContent).toMatch(/Tue 3 Nov 2026, 14:00–17:00/);
    expect(screen.getByTestId("existing-bookings").textContent).toMatch(/Wed 4 Nov 2026, 12:00–14:00/);
    expect(screen.getByTestId("schedule-keep")).not.toBeChecked();
    expect(screen.getByTestId("schedule-override")).not.toBeChecked();
    expect(screen.queryByText(/Change the existing/i)).toBeNull();
    expect(screen.getAllByTestId("complete-day")).toHaveLength(2);
    expect(screen.getByTestId("materials-section")).not.toHaveAttribute("open");
    fireEvent.click(screen.getByTestId("mark-completed-save"));
    expect(rpc).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringMatching(/add these days or replace/) }));
  });

  it("override sends the new days only, and leaves materials alone while the section is closed", () => {
    renderDialog({ seedVisits: [{ date: "2026-11-01", start: "08:00", end: "12:00" }, { date: "2026-11-02", start: "08:00", end: "16:00" }] });
    fireEvent.click(screen.getByTestId("schedule-override"));
    fireEvent.click(screen.getByTestId("mark-completed-save"));
    expect(rpc).toHaveBeenCalledWith("admin_mark_job_completed", expect.objectContaining({
      p_schedule_mode: "override",
      p_materials: null,
      p_visits: [
        { date: "2026-11-01", start: "08:00", end: "12:00" },
        { date: "2026-11-02", start: "08:00", end: "16:00" },
      ],
    }));
  });

  it("adds another day in the list", () => {
    renderDialog({ seedVisits: [{ date: "2026-11-01", start: "08:00", end: "12:00" }] });
    fireEvent.click(screen.getByTestId("add-complete-day"));
    expect(screen.getAllByTestId("complete-day")).toHaveLength(2);
  });

  it("opens materials on the quote, shows the booked stock, and adds only the new item", () => {
    renderDialog({
      materialsDefaultOpen: true,
      seedVisits: [{ date: "2026-11-01", start: "08:00", end: "12:00" }],
    });
    expect(screen.getByTestId("materials-section")).toHaveAttribute("open");
    expect(screen.getByDisplayValue("Indoor cassette")).toBeTruthy();
    expect(screen.getByDisplayValue("Copper pipe")).toBeTruthy();
    expect(screen.getByTestId("existing-materials").textContent).toMatch(/Copper pipe · 6 m · drawn 6 m/);
    expect(screen.getByTestId("existing-materials").textContent).toMatch(/not the same as the quote/);
    expect(screen.getByTestId("materials-keep")).not.toBeChecked();
    expect(screen.getByTestId("materials-override")).not.toBeChecked();
    fireEvent.click(screen.getByTestId("add-material"));
    const items = screen.getAllByLabelText(/Item|Unit/);
    fireEvent.change(items[items.length - 1], { target: { value: "Wall brackets" } });
    fireEvent.click(screen.getByTestId("schedule-keep"));
    fireEvent.click(screen.getByTestId("materials-keep"));
    fireEvent.click(screen.getByTestId("mark-completed-save"));
    const payload = rpc.mock.calls[0][1];
    expect(payload.p_schedule_mode).toBe("keep_add");
    expect(payload.p_materials_mode).toBe("keep_add");
    expect(payload.p_materials.map((l: { item: string }) => l.item)).toEqual(["Indoor cassette", "Wall brackets"]);
    expect(payload.p_materials.find((l: { item: string }) => l.item === "Copper pipe")).toBeUndefined();
  });

  it("a repair with no extra parts shows the consumable note and does not invent gas", () => {
    renderDialog({
      materialsDefaultOpen: true,
      fixtures: { kind: "service", visits: [], quote: install.quote, booked: [] },
      seedVisits: [{ date: "2026-11-01", start: "08:00", end: "10:00" }],
    });
    expect(screen.getByTestId("materials-note").textContent).toMatch(/R410 or R32/);
    expect(screen.queryByDisplayValue("Copper pipe")).toBeNull();
    expect(screen.queryByDisplayValue("Indoor cassette")).toBeNull();
    expect(screen.queryByTestId("existing-bookings")).toBeNull();
    expect(screen.queryByTestId("schedule-choice")).toBeNull();
  });
});
