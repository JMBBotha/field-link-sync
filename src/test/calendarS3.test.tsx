import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import NeedsSomeoneTray from "@/components/calendar/NeedsSomeoneTray";
import DayCards, { LoadBar } from "@/components/calendar/DayCards";
import { calendarScheduleToCard, freeGaps, salesCalendarPeople, type CalendarLead, type CalendarSchedule } from "@/components/calendar/calendarModel";
import AttentionStrip from "@/components/jobs/AttentionStrip";

const state = vi.hoisted(() => ({ count: 1, sales: false, mobile: false }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => state.mobile }));
vi.mock("@/hooks/useSalesRep", () => ({ useSalesRep: () => ({ isSalesRep: state.sales, loading: false }) }));
vi.mock("@/hooks/useRole", () => ({ useRole: () => ({ userId: "me" }) }));
vi.mock("@/hooks/useDoubleBookings", () => ({ useDoubleBookings: () => ({ count: state.count, rows: [{ profile_id: "me" }, { profile_id: "other" }] }) }));
vi.mock("@/hooks/useLeadSla", () => ({ useNow: () => new Date(), useLeadSla: () => ({ sla: { contactMinutes: 15 } }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: { leads: [], lateJobs: 0, paidNoJob: 0 } }) }));
vi.mock("@/components/leads/CallSummary", () => ({ default: () => null }));

const lead: CalendarLead = { id: "lead", customer_name: "Client", customer_address: "Milnerton, Cape Town", service_type: "Sales visit", status: "pending", priority: "normal", assigned_agent_id: null, scheduled_date: "2026-10-08", scheduled_time: "14:00:00", primary_intent: "sales" };
const schedule: CalendarSchedule = { id: "schedule", lead_id: "lead", job_id: "job", agent_id: "me", scheduled_date: "2026-10-08", start_time: "14:00:00", end_time: "18:00:00", notes: null, leads: lead };
const trayProps = { onLeadDragStart: vi.fn(), onScheduleDragStart: vi.fn(), onDragEnd: vi.fn(), onAssignLead: vi.fn(), onAssignPool: vi.fn() };
const dayProps = { date: "2026-10-08", groups: [{ key: "sales" as const, label: "Sales", agents: [{ id: "me", full_name: "Lisa", availability_status: null }] }], leads: [lead], sales: false, isAgentOnline: () => true, onJobInfoClick: vi.fn(), onScheduleDragStart: vi.fn(), onDragEnd: vi.fn(), onDrop: vi.fn(), onDragOver: vi.fn(), dragOverSlot: null, onSlotDragEnter: vi.fn(), onSlotDragLeave: vi.fn() };
afterEach(() => { cleanup(); state.mobile = false; state.sales = false; state.count = 1; vi.clearAllMocks(); });

describe("Calendar S3", () => {
  it("renders tray groups, exact explanations, HH:MM and assignment actions", () => {
    render(<NeedsSomeoneTray {...trayProps} leads={[lead]} pool={[{ ...schedule, agent_id: null }]} />);
    expect(screen.getByTestId("tray-unassigned")).toHaveTextContent("A date and time is booked (e.g. by Mandy or the office) but no salesperson or tech has been chosen.");
    expect(screen.getByTestId("tray-open")).toHaveTextContent("An installation passed to Technical without a named tech. Any tech can take it, or drag it to someone.");
    expect(screen.getByTestId("tray-unassigned")).toHaveTextContent("14:00–15:00");
    expect(screen.getByTestId("tray-open")).toHaveTextContent("14:00–18:00");
    fireEvent.click(screen.getAllByRole("button", { name: "Assign…" })[0]);
    expect(trayProps.onAssignLead).toHaveBeenCalledWith(lead);
  });
  it("hides empty groups and shows the empty line", () => {
    const r = render(<NeedsSomeoneTray {...trayProps} leads={[lead]} pool={[]} />);
    expect(screen.queryByTestId("tray-open")).toBeNull();
    r.rerender(<NeedsSomeoneTray {...trayProps} leads={[]} pool={[]} />);
    expect(screen.queryByTestId("tray-unassigned")).toBeNull();
    expect(screen.getByText("Nobody needed: every booking has a person.")).toBeTruthy();
  });
  it("folds the mobile tray into a tap-to-expand strip", () => {
    state.mobile = true;
    render(<NeedsSomeoneTray {...trayProps} leads={[lead]} pool={[]} />);
    expect(screen.queryByTestId("tray-unassigned")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "🙋 1 need someone" }));
    expect(screen.getByTestId("tray-unassigned")).toBeTruthy();
  });
  it("clips free gaps to the working day and preserves the existing drop handler", () => {
    expect(freeGaps([schedule])).toEqual([{ start: "08:00", end: "14:00", minutes: 360 }]);
    render(<DayCards {...dayProps} schedules={[schedule]} />);
    expect(screen.getAllByTestId("free-gap")).toHaveLength(1);
    const gap = screen.getByTestId("free-gap");
    expect(gap).toHaveTextContent("Free 08:00–14:00 · 6 h open");
    expect(screen.getByTestId("booking-time")).toHaveTextContent("14:00–18:00 · 4 h");
    fireEvent.drop(gap);
    expect(dayProps.onDrop).toHaveBeenCalledWith(expect.anything(), "me", "2026-10-08", 8);
  });
  it.each([[240, false, "primary"], [406, false, "warning"], [540, false, "warning"], [541, false, "destructive"], [60, true, "destructive"]])("load bar %s minutes clash %s uses %s", (minutes, clash, tone) => {
    render(<LoadBar minutes={Number(minutes)} clash={Boolean(clash)} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("data-tone", String(tone));
  });
  it("filters sales to their own person and renders an unreadable booking as Busy", () => {
    const people = salesCalendarPeople([{ id: "me" }, { id: "other" }], true, "me");
    expect(people).toEqual([{ id: "me" }]);
    render(<DayCards {...dayProps} sales schedules={[{ ...schedule, leads: null }]} />);
    expect(screen.getAllByTestId("person-day-card")).toHaveLength(1);
    expect(screen.getByTestId("busy-block")).toHaveTextContent("Busy14:00–18:00 · 4 h");
    expect(screen.queryByText(/undefined|^Job$/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/R\s?\d/);
    const source = readFileSync("src/pages/admin/AdminDispatchPage.tsx", "utf8");
    expect(source).toContain('if (isSalesRep) query = query.eq("agent_id", userId || "")');
    expect(source).toContain("!isSalesRep || l.assigned_agent_id === userId");
  });
  it("maps SAST time, service fallback and job identity without money", () => {
    const card = calendarScheduleToCard({ ...schedule, leads: { ...lead, customer_name: "", service_type: "Installation" } });
    expect(card.title).toBe("Installation");
    expect(card.scheduledFor).toBe("2026-10-08T14:00:00+02:00");
    expect(card.kind).toBe("job");
  });
  it.each([1, 2])("AttentionStrip uses singular/plural for %s", count => {
    state.count = count;
    render(<MemoryRouter><AttentionStrip /></MemoryRouter>);
    expect(screen.getByRole("link", { name: `${count} double booking${count === 1 ? "" : "s"}` })).toBeTruthy();
  });
  it("sales attention counts only their own double bookings", () => {
    state.sales = true; state.count = 2;
    render(<MemoryRouter><AttentionStrip /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "1 double booking" })).toBeTruthy();
    expect(screen.queryByText("double bookings")).toBeNull();
  });
});