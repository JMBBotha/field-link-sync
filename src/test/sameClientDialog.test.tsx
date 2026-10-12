import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import SameClientDialog from "@/components/leads/SameClientDialog";

const row = { lead_id: "k", customer_name: "Johan Botha", status: "accepted", scheduled_date: "2026-10-13", scheduled_time: "10:00:00",
  tech_id: "t", tech_name: "Thabo Mokoena", booked: true, match: "strong" };

describe("SameClientDialog", () => {
  it("shows the existing booking and the three choices", () => {
    const onReplace = vi.fn(), onSecondVisit = vi.fn(), onCancel = vi.fn();
    render(<SameClientDialog rows={[row]} onReplace={onReplace} onSecondVisit={onSecondVisit} onCancel={onCancel} />);
    expect(screen.getByText(/already has a booking on .*13 Oct 10:00 with Thabo Mokoena/)).toBeTruthy();
    fireEvent.click(screen.getByText("Replace it")); expect(onReplace).toHaveBeenCalledWith(row);
    fireEvent.click(screen.getByText("Add as second visit")); expect(onSecondVisit).toHaveBeenCalledWith(row);
    fireEvent.click(screen.getByText("Cancel")); expect(onCancel).toHaveBeenCalled();
  });
  it("renders nothing without matches", () => {
    render(<SameClientDialog rows={[]} onReplace={vi.fn()} onSecondVisit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByTestId("same-client-dialog")).toBeNull();
  });
});
