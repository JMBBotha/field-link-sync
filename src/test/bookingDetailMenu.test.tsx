import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import BookingDetailView from "@/components/jobs/BookingDetailView";
import { readFileSync } from "node:fs";

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
for (const k of ["hasPointerCapture", "setPointerCapture", "releasePointerCapture"] as const) {
  if (!(Element.prototype as unknown as Record<string, unknown>)[k]) {
    (Element.prototype as unknown as Record<string, () => void>)[k] = () => {};
  }
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const NOTES = "Transcript:\nUser: The unit is leaking.\nAI: I can book tomorrow.";
const booking = {
  id: "lead-1",
  customer_name: "Demo Client",
  customer_phone: "0210000000",
  customer_address: "14 Demo Lane",
  customer_id: "client-1",
  service_type: "Service",
  notes: NOTES,
  tech_name: "Demo Tech A",
  date: "2026-11-12",
  time: "09:00",
  status: "assigned",
  assigned_agent_id: "tech-a",
  perms: { admin: true, rep: false, office: true, view: true },
  quotes: [{ id: "q1", quote_number: "Q-D-014", status: "sent" }],
};

function view(over: Partial<ComponentProps<typeof BookingDetailView>> = {}) {
  const onReassign = vi.fn();
  const onCancelOpen = vi.fn();
  render(
    <BookingDetailView
      booking={booking}
      cancelOpen={false}
      onCancelOpen={onCancelOpen}
      onConfirmCancel={() => {}}
      onReschedule={() => {}}
      onOpenQuote={() => {}}
      onReassign={onReassign}
      onEdit={() => {}}
      onSetPin={() => {}}
      onOpenClient={() => {}}
      onCloseLead={() => {}}
      onReturn={() => {}}
      confirmOpen={false}
      onConfirmOpen={() => {}}
      {...over}
    />,
  );
  return { onReassign, onCancelOpen };
}

describe("booking page actions", () => {
  it("puts Cancel visit, Reschedule and Open quote on the page, and the rest in More", async () => {
    view();
    expect(screen.getByTestId("booking-cancel")).toHaveTextContent("Cancel visit");
    expect(screen.getByTestId("booking-reschedule")).toHaveTextContent("Reschedule");
    expect(screen.getByTestId("booking-open-quote")).toHaveTextContent("Open quote");
    expect(screen.getByTestId("booking-quote-list")).toHaveTextContent("Q-D-014");
    fireEvent.pointerDown(screen.getByTestId("booking-more"));
    fireEvent.keyDown(screen.getByTestId("booking-more"), { key: "Enter" });
    for (const label of ["Reassign tech", "Confirm booking", "Close lead", "Edit booking", "Set map pin", "Open client", "Return visit"]) {
      expect(await screen.findByRole("menuitem", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByTestId("booking-notes")).toBeInTheDocument();
  });

  it("keeps the call transcript behind Show call notes", () => {
    view();
    expect(screen.queryByTestId("call-notes-body")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("show-call-notes"));
    expect(screen.getByTestId("call-notes-body")).toHaveTextContent("The unit is leaking");
  });

  it("opens the technician dialog from the pill and the cancel dialog from the button", () => {
    const { onReassign, onCancelOpen } = view();
    fireEvent.click(screen.getByTestId("booking-tech-pill"));
    expect(onReassign).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("booking-cancel"));
    expect(onCancelOpen).toHaveBeenCalledWith(true);
  });

  it("portals the More menus", () => {
    const menu = readFileSync("src/components/ui/dropdown-menu.tsx", "utf8");
    expect(menu).toContain("DropdownMenuPrimitive.Portal");
    expect(menu).toContain("z-50");
    const booking = readFileSync("src/pages/admin/AdminBookingDetailPage.tsx", "utf8");
    const viewSrc = readFileSync("src/components/jobs/BookingDetailView.tsx", "utf8");
    const job = readFileSync("src/pages/admin/AdminJobDetailPage.tsx", "utf8");
    expect(booking).toContain("BookingDetailView");
    expect(viewSrc).toContain("StaffMoreMenu");
    expect(booking).toContain("cancel_booking_visit");
    expect(booking).not.toContain("<details");
    expect(job).toContain('testId="job-more"');
    expect(job).toContain("StaffMoreMenu");
    expect(job).toContain("cancel_booking_visit");
    expect(job).not.toContain("absolute right-0 z-20");
    expect(readFileSync("src/components/jobs/StaffMoreMenu.tsx", "utf8")).toContain('className="z-50 w-56 rounded-xl p-1"');
  });
});
