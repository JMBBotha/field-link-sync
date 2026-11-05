import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import JobsCalmView, { type CalmBlock } from "@/components/jobs/calm/JobsCalmView";

const block = (over: Partial<CalmBlock> = {}): CalmBlock => ({
  id: "job-1", uid: "job:job-1:2099-06-02", kind: "job", personId: "tech-1", day: "2099-06-02",
  start: 9 * 60 + 30, dur: 120, end: 11 * 60 + 30, title: "Installation — 14 Oak Street",
  place: "14 Oak Street, Cape Town", block: "install", late: false, draggable: true,
  client: "Youssin", jobType: "installation", assignee: "Innocent Mattienga", assigneeRole: "service",
  status: "scheduled", href: "/admin/jobs/job-1", ...over,
});

const visit = (over: Partial<CalmBlock> = {}): CalmBlock => ({
  id: "v-lead:lead-1", uid: "visit:lead-1", kind: "visit", personId: "rep-1", day: "2099-06-03",
  start: 14 * 60, dur: 60, title: "Youssin", place: "Sea Point", block: "sales", draggable: false,
  client: "Youssin", serviceType: "Sales/Consultation", assignee: "Johan Botha", assigneeRole: "sales",
  status: "pending", href: "/admin/bookings/lead-1", dayIndex: 2, dayCount: 3, ...over,
});

function renderCalm(over: Partial<Parameters<typeof JobsCalmView>[0]> = {}) {
  const onOpenBlock = vi.fn();
  const onPickDay = vi.fn();
  const onMoveBlock = vi.fn();
  const props = {
    tab: "month" as const, onTab: vi.fn(), dateLabel: "June 2099", onNew: vi.fn(),
    leads: [], leadsTotal: 0, showAllLeads: false, onShowAll: vi.fn(),
    people: [
      { id: "tech-1", name: "Innocent Mattienga", role: "Tech", dot: "blue" as const },
      { id: "rep-1", name: "Johan Botha", role: "Sales", dot: "grey" as const },
    ],
    blocks: [block(), visit()],
    unassigned: [],
    weekDays: [
      { day: "2099-06-02", label: "Tue 2" },
      { day: "2099-06-03", label: "Wed 3" },
    ],
    everyone: "all", everyoneOptions: [{ value: "all", label: "Everyone" }], onEveryone: vi.fn(),
    chip: null, onChip: vi.fn(), counts: { leadsNotContacted: 0, late: 0, unassigned: 0 },
    onCallLead: vi.fn(), onAssignLead: vi.fn(), onOpenLead: vi.fn(),
    onAssignJob: vi.fn(), onOpenJob: vi.fn(), onOpenBlock, onMoveBlock, onPickDay,
    monthCells: [
      { day: "2099-06-01", inMonth: true },
      { day: "2099-06-02", inMonth: true },
      { day: "2099-06-03", inMonth: true },
    ],
    todayDay: "2099-06-02",
    pipeline: <div>Pipeline board</div>,
    ...over,
  };
  const view = render(<JobsCalmView {...props} />);
  return { ...view, onOpenBlock, onPickDay, onMoveBlock };
}

const chip = (container: HTMLElement, id: string) => container.querySelector(`[data-booking-id="${id}"]`) as HTMLButtonElement;

describe("jobs calendar bookings", () => {
  it("shows the client and time on the month chip instead of a generic installation", () => {
    const { container } = renderCalm();
    const el = chip(container, "job-1");
    expect(el.textContent).toContain("09:30");
    expect(el.textContent).toContain("Youssin");
    expect(el.textContent).not.toMatch(/Installation/);
    expect(el.getAttribute("data-booking-href")).toBe("/admin/jobs/job-1");
    expect(el.getAttribute("aria-label")).toContain("Innocent Mattienga");
    expect(el.getAttribute("aria-label")).toContain("14 Oak Street, Cape Town");
  });

  it("opens the job on click and does not open the day", () => {
    const { container, onOpenBlock, onPickDay } = renderCalm();
    const el = chip(container, "job-1");
    const cell = el.closest("[data-calm-month-day]") as HTMLElement;
    const swallowed = vi.fn();
    cell.addEventListener("click", swallowed);
    fireEvent.click(el);
    expect(onOpenBlock).toHaveBeenCalledTimes(1);
    expect(onOpenBlock.mock.calls[0][0].id).toBe("job-1");
    expect(onOpenBlock.mock.calls[0][0].href).toBe("/admin/jobs/job-1");
    expect(onPickDay).not.toHaveBeenCalled();
    expect(swallowed).not.toHaveBeenCalled();
    const day = [...cell.querySelectorAll("button")].find((b) => !b.hasAttribute("data-calm-block"))!;
    fireEvent.click(day);
    expect(onPickDay).toHaveBeenCalledWith("2099-06-02");
    expect(onOpenBlock).toHaveBeenCalledTimes(1);
  });

  it("shows the booking on hover and keyboard focus, and a touch tap opens it once", () => {
    const { container, onOpenBlock } = renderCalm();
    const el = chip(container, "job-1");
    fireEvent.pointerEnter(el, { pointerType: "mouse" });
    const popup = () => document.body.querySelector("[data-calm-popup]");
    expect(popup()?.textContent).toContain("Youssin");
    expect(popup()?.textContent).toContain("New Installation");
    expect(popup()?.textContent).toContain("09:30–11:30");
    expect(popup()?.textContent).toContain("Innocent Mattienga");
    expect(popup()?.textContent).toContain("14 Oak Street, Cape Town");
    expect(popup()?.textContent).toContain("Scheduled");
    fireEvent.pointerLeave(el, { pointerType: "mouse" });
    expect(popup()).toBeNull();
    fireEvent.focus(el);
    expect(popup()?.textContent).toContain("Technician");
    fireEvent.keyDown(el, { key: "Escape" });
    expect(popup()).toBeNull();
    // jsdom has no PointerEvent, so fireEvent cannot carry pointerType. Dispatch one that does.
    const touch = new Event("pointerenter", { bubbles: true });
    Object.defineProperty(touch, "pointerType", { value: "touch" });
    el.dispatchEvent(touch);
    expect(popup()).toBeNull();
    fireEvent.click(el);
    expect(onOpenBlock).toHaveBeenCalledTimes(1);
  });

  it("omits unknown popup rows and does not navigate when there is no record", () => {
    const { container, onOpenBlock, onPickDay } = renderCalm({
      blocks: [block({
        client: null, title: "Installation", place: null, assignee: null, status: null, end: null, href: null, jobType: "installation",
      })],
    });
    const el = chip(container, "job-1");
    expect(el.textContent).toContain("09:30");
    expect(el.textContent).toContain("Install");
    expect(el.textContent).not.toMatch(/Installation/);
    fireEvent.focus(el);
    const text = document.body.querySelector("[data-calm-popup]")?.textContent || "";
    expect(text).not.toMatch(/Location|Technician|Rep|Client/);
    expect(text).not.toMatch(/09:30–/);
    fireEvent.click(el);
    expect(onOpenBlock).not.toHaveBeenCalled();
    expect(onPickDay).not.toHaveBeenCalled();
  });

  it("opens a visit booking and labels a multi-day run on week and today", () => {
    const week = renderCalm({ tab: "week" });
    const v = chip(week.container, "v-lead:lead-1");
    expect(v.textContent).toContain("Youssin");
    expect(v.textContent).toContain("Day 2/3");
    expect(v.getAttribute("data-booking-href")).toBe("/admin/bookings/lead-1");
    fireEvent.click(v);
    expect(week.onOpenBlock.mock.calls[0][0].href).toBe("/admin/bookings/lead-1");
    fireEvent.focus(v);
    expect(document.body.querySelector("[data-calm-popup]")?.textContent).toContain("Johan Botha");
    week.unmount();

    const today = renderCalm({ tab: "today", blocks: [block(), visit({ day: "2099-06-02", dayIndex: 2, dayCount: 3 })] });
    expect(chip(today.container, "job-1").textContent).toContain("Youssin");
    expect(chip(today.container, "v-lead:lead-1").textContent).toContain("Day 2/3");
    expect(chip(today.container, "job-1").getAttribute("draggable")).toBe("true");
    expect(chip(today.container, "v-lead:lead-1").getAttribute("draggable")).toBe("false");
  });

  it("leaves Pipeline free of calendar bookings", () => {
    const { container } = renderCalm({ tab: "pipeline" });
    expect(container.querySelector("[data-calm-block]")).toBeNull();
    expect(container.textContent).toContain("Pipeline board");
  });
});
