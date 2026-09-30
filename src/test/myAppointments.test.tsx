import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { sortAppointments, formatAppointmentWhen, appointmentLinks, type MyAppointment } from "@/lib/appointments";
import MyAppointmentsList from "@/components/admin/MyAppointmentsList";

const row = (o: Partial<MyAppointment>): MyAppointment => ({
  lead_id: "L1", scheduled_date: "2026-10-01", scheduled_time: "09:00:00", customer_name: "Client",
  address: "1 Main Rd", service_type: "installation", status: "assigned", is_mine: true, source: "lead",
  quote_id: null, customer_id: null, ...o,
});

describe("my appointments helpers", () => {
  it("sorts soonest first, untimed last within a day", () => {
    const out = sortAppointments([
      row({ lead_id: "c", scheduled_date: "2026-10-03" }),
      row({ lead_id: "b", scheduled_date: "2026-10-01", scheduled_time: null }),
      row({ lead_id: "a", scheduled_date: "2026-10-01", scheduled_time: "14:00:00" }),
      row({ lead_id: "z", scheduled_date: "2026-10-01", scheduled_time: "08:30:00" }),
    ]);
    expect(out.map((r) => r.lead_id)).toEqual(["z", "a", "b", "c"]);
  });

  it("formats time and TBC", () => {
    expect(formatAppointmentWhen("2026-10-01", "09:00:00")).toMatch(/09:00$/);
    expect(formatAppointmentWhen("2026-10-01", null)).toMatch(/time TBC$/);
    expect(formatAppointmentWhen("2026-10-01", null)).toMatch(/1/);
  });

  it("links to lead and quote, or start quote from the lead", () => {
    expect(appointmentLinks({ lead_id: "L1", quote_id: "Q1" })).toEqual({ lead: "/admin/dispatch?lead=L1", quote: "/admin/estimates/Q1", quoteLabel: "Open quote" });
    expect(appointmentLinks({ lead_id: "L1", quote_id: null })).toEqual({ lead: "/admin/dispatch?lead=L1", quote: "/admin/quotes?leadId=L1", quoteLabel: "Start quote" });
  });
});

describe("MyAppointmentsList", () => {
  it("renders client, address, pool badge and limits rows", () => {
    render(
      <MemoryRouter>
        <MyAppointmentsList limit={2} rows={[
          row({ lead_id: "A", customer_name: "Alice", quote_id: "Q9" }),
          row({ lead_id: "B", customer_name: "Bob", is_mine: false, address: "5 Pool St" }),
          row({ lead_id: "C", customer_name: "Carol" }),
        ]} />
      </MemoryRouter>,
    );
    expect(screen.getAllByTestId("my-appointment-row")).toHaveLength(2);
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("5 Pool St")).toBeTruthy();
    expect(screen.getByText("Available")).toBeTruthy();
    expect(screen.queryByText("Carol")).toBeNull();
    expect(screen.getByText(/Open quote/).closest("a")?.getAttribute("href")).toBe("/admin/estimates/Q9");
    expect(screen.getByText(/Start quote/).closest("a")?.getAttribute("href")).toBe("/admin/quotes?leadId=B");
  });

  it("shows empty state", () => {
    render(<MemoryRouter><MyAppointmentsList rows={[]} /></MemoryRouter>);
    expect(screen.getByText("No upcoming appointments.")).toBeTruthy();
  });
});
