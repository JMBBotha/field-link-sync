import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HouseCard } from "@/components/projects/ProjectView";
import { houseReminders, houseStatus, type HouseMoney, type ProjectHouse, type ProjectStep } from "@/lib/projectTracker";

const step = (key: string, done: boolean): ProjectStep => ({ id: key, step_key: key, label: key, rate: 0, sort_order: 0, done, paid: false });
const house = (over: ProjectHouse["status_override"], done: boolean[]): ProjectHouse => ({
  id: "h", house_no: "1", phase_id: null, po_number: null, make: "Samsung", unit_sizes: null,
  units_ordered: 0, units_received: 0, ready_for_aircon: false, ready_for_aircon_at: null,
  status_override: over, notes: null,
  steps: ["first_fit", "piping", "units", "commissioning"].map((k, i) => step(k, done[i])),
});
const money = (paid: number, extra: Partial<HouseMoney["invoices"][number]> = {}): HouseMoney => ({
  invoiced: 100, paid, invoiceCount: 1, invoiceNumbers: ["INV-1"],
  invoices: [{ id: "i", number: "INV-1", total: 100, paid, sent_at: "2026-09-01T08:00:00Z", ...extra }],
});

function card(h: ProjectHouse, m?: HouseMoney) {
  return render(
    <MemoryRouter>
      <HouseCard h={h} status={houseStatus(h, m)} money={m} onOpen={() => {}} />
    </MemoryRouter>,
  );
}

describe("Done & paid houses do not chase an invoice", () => {
  it("hides the final-half reminder and the red no-invoice line when paid outside CT", () => {
    card(house("done", [true, true, true, true]));
    expect(screen.getByTestId("stage-chip")).toHaveTextContent("Done & paid");
    expect(screen.queryByTestId("house-reminder")).toBeNull();
    expect(screen.queryByTestId("house-no-invoice")).toBeNull();
    expect(houseReminders(house("done", [true, true, true, true]))).toEqual([]);
  });

  it("keeps no-invoice on a house that still needs one", () => {
    card(house(null, [false, false, false, false]));
    expect(screen.getByTestId("house-no-invoice")).toHaveTextContent("no invoice");
    expect(screen.queryByTestId("house-reminder")).toBeNull();
  });

  it("keeps the deposit chip when the first half is unpaid, and does not call it the final half", () => {
    const h = house(null, [true, true, false, false]);
    card(h, money(0));
    expect(screen.getByTestId("stage-chip")).toHaveTextContent("Deposit 50% unpaid · invoice sent");
    expect(screen.queryByText(/final 50%/i)).toBeNull();
    expect(houseReminders(h, money(0)).some((r) => r.kind === "final_due")).toBe(false);
  });

  it("shows the final half, with a stored expected date, only after the job is complete", () => {
    const h = house(null, [true, true, true, true]);
    const m = money(50, { expected_final_date: "2026-12-15" });
    card(h, m);
    expect(screen.getByTestId("stage-chip")).toHaveTextContent("Job complete · final 50% unpaid · expected 15 Dec 2026");
    expect(screen.getByTestId("house-reminder")).toHaveTextContent("Final 50% still unpaid · job is complete on INV-1 · expected 15 Dec 2026");
  });
});
