import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import JobCard from "@/components/cards/JobCard";
import { jobToCard, visitToCard, visibleVisitEntries, type CardJob } from "@/lib/cardModel";

const item: CardJob = {
  kind: "job", id: "j1", title: "Install inverter", scheduledFor: "2026-10-08T09:30:00+02:00",
  statusKey: "unassigned", priority: "high", place: "Cape Town", clientName: "Client",
  lane: "sales", urgency: { key: "unassigned", rank: 1, mins: 30 },
};

describe("shared JobCard", () => {
  it.each(["full", "compact"] as const)("renders %s with shared header, title, place and tags", (density) => {
    render(<JobCard item={item} density={density} audience="office" onOpen={vi.fn()} onAssign={vi.fn()} onAuto={vi.fn()} />);
    expect(screen.getByText("Install inverter")).toBeTruthy();
    expect(screen.getByText("Cape Town · Client")).toBeTruthy();
    expect(screen.getByText("UNASSIGNED")).toBeTruthy();
    expect(screen.getByText("SALES")).toBeTruthy();
    expect(screen.getByText("starts in 30m")).toBeTruthy();
    expect(screen.getByRole("button", { name: density === "full" ? "Assign tech" : "Assign" })).toBeTruthy();
    if (density === "compact") {
      fireEvent.keyDown(screen.getByRole("button", { name: "Job actions" }), { key: "Enter", code: "Enter" });
      expect(screen.getByRole("menuitem", { name: "Auto" })).toBeTruthy();
    } else expect(screen.getByRole("button", { name: "Auto" })).toBeTruthy();
  });

  it("tech audience never renders money or Assign/Auto/Invoice, including supplied actions", () => {
    const { container } = render(<JobCard item={{ ...item, title: "Install R 1250", place: "R500", clientName: "Client R 100", assigneeName: "Tech R50" }}
      density="full" audience="tech" onOpen={vi.fn()} onAssign={vi.fn()} onAuto={vi.fn()}
      actions={<span>Invoice R 900 Assign Auto</span>}
      menuItems={[{ label: "Open invoice", onSelect: vi.fn() }, { label: "Assign", onSelect: vi.fn() }, { label: "Auto", onSelect: vi.fn() }, { label: "Open job", onSelect: vi.fn() }]} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Job actions" }), { key: "Enter", code: "Enter" });
    expect(document.body.textContent).not.toMatch(/R\s?\d/);
    expect(document.body.textContent).not.toMatch(/Assign|Auto|Invoice|invoice/);
    expect(container.querySelector("[data-dispatch-card]" )?.getAttribute("aria-label")).not.toMatch(/R\s?\d/);
  });

  it("passes drag handlers and draggable onto the root only when supplied", () => {
    const start = vi.fn(), end = vi.fn();
    const { container } = render(<JobCard item={item} density="compact" audience="office" onOpen={vi.fn()}
      draggable onDragStart={start} onDragEnd={end} />);
    const root = container.querySelector('[data-dispatch-card="j1"]');
    expect(root?.getAttribute("draggable")).toBe("true");
    if (!root) throw new Error("Missing card root");
    fireEvent.dragStart(root); fireEvent.dragEnd(root);
    expect(start).toHaveBeenCalledTimes(1); expect(end).toHaveBeenCalledTimes(1);
  });

  it("lane and assignee chips filter without opening the card", () => {
    const open = vi.fn(), lane = vi.fn(), assignee = vi.fn();
    render(<JobCard item={item} density="compact" audience="office" onOpen={open} onLaneClick={lane} onAssigneeClick={assignee} />);
    fireEvent.click(screen.getByLabelText("Filter Sales"));
    fireEvent.click(screen.getByLabelText("Filter unassigned"));
    expect(lane).toHaveBeenCalledTimes(1); expect(assignee).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });
});

describe("overdue late cards", () => {
  it("3 days late shows 'Overdue ·' with the scheduled date and no Late hours", () => {
    render(<JobCard item={{ ...item, scheduledFor: "2026-01-09T09:30:00+02:00",
      urgency: { key: "late", rank: 0, mins: -(3 * 24 * 60 + 26) } }}
      density="full" audience="office" onOpen={vi.fn()} />);
    expect(screen.getByText(/Overdue · 9 Jan/)).toBeTruthy();
    expect(screen.queryByText(/Late/)).toBeNull();
  });
  it("late by 24 h or less still shows the Late hours", () => {
    render(<JobCard item={{ ...item, scheduledFor: "2026-10-08T09:30:00+02:00",
      urgency: { key: "late", rank: 0, mins: -86 } }}
      density="full" audience="office" onOpen={vi.fn()} />);
    expect(screen.getByText("Late 1h 26m")).toBeTruthy();
  });
});

describe("visibleVisitEntries", () => {
  it("drops booked visits with no job row and a hidden (empty-name) lead", () => {
    expect(visibleVisitEntries([
      { job_id: null, customer_name: null },
      { job_id: null, customer_name: "" },
      { job_id: null, customer_name: "  " },
      { job_id: null, customer_name: "Visible" },
      { job_id: "j1", customer_name: null },
    ])).toEqual([
      { job_id: null, customer_name: "Visible" },
      { job_id: "j1", customer_name: null },
    ]);
  });
});

describe("card model adapters", () => {
  it("ignores rejected assignments but keeps completed and cancelled statuses", () => {
    expect(jobToCard({ id: "j", status: "scheduled", assignments: [{ profile_id: "p", status: "rejected" }] }).statusKey).toBe("unassigned");
    expect(jobToCard({ id: "j", status: "completed" }).statusKey).toBe("completed");
    expect(jobToCard({ id: "j", status: "cancelled" }).statusKey).toBe("cancelled");
  });
  it("maps booked visits with their lane, named assignee and Johannesburg time", () => {
    const card = visitToCard({ key: "lead:l", lead_id: "l", job_id: null, agent_id: "p", date: "2026-10-08",
      start_time: "10:15:00", status: "pending", customer_name: "Visit", customer_address: "Cape Town", primary_intent: "sales" },
      { p: { full_name: "Salesperson" } });
    expect(card).toMatchObject({ kind: "visit", id: "l", lane: "sales", assigneeName: "Salesperson", statusKey: "pending", scheduledFor: "2026-10-08T10:15:00+02:00" });
  });
});