import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/contexts/OfflineContext", () => ({ useOfflineContext: () => ({ isOnline: true, queueOperation: vi.fn(), syncPendingOperations: vi.fn() }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "t1" } }) }));
vi.mock("@/hooks/useSignedInIdentity", () => ({ useSignedInIdentity: () => ({ name: "Sipho", role: "tech", pending: false }) }));

import {
  autoHours, dayAction, dayBadge, dayLabel, doneForTodayError, hoursNeedNote, planSummary, remainingDays, skipText, sumDayHours,
  type JobDay, type JobDays, type DaysPlan,
} from "@/lib/jobDays";
import { applyDayOp, JobDaysView, DoneForTodaySheet } from "@/components/field/JobDaysPanel";
import { MultiDayPickerView, multiDayBlocked } from "@/components/scheduling/MultiDayPicker";
import { buildCalendarEntries, overdueEntries } from "@/lib/todaysJobs";
import { offerSummary } from "@/lib/installHandoff";

const day = (i: number, date: string, extra: Partial<JobDay> = {}): JobDay => ({
  schedule_id: `s${i}`, day_index: i, day_count: 3, date, start: "08:00", end: "17:00", agent_id: "t1",
  en_route_at: null, checked_in_at: null, checked_out_at: null, hours: null, hours_auto: null, hours_edit_note: null, notes: null, state: "upcoming", ...extra,
});
const run = (days: JobDay[], status = "in_progress"): JobDays => ({
  job_id: "j1", status, today: "2026-10-27", multi_day: true, day_count: days.length, scheduled_until: null, days, labour_hours: sumDayHours(days),
});
const d1done = day(1, "2026-10-26", { checked_in_at: "2026-10-26T06:00:00Z", checked_out_at: "2026-10-26T15:00:00Z", hours: 9, state: "done" });

describe("job days helpers (phase b)", () => {
  it("labels days without a time-zone shift and summarises a plan", () => {
    expect(dayLabel("2026-10-26")).toBe("Mon 26 Oct");
    expect(planSummary({ day_count: 3, first: "2026-10-23", last: "2026-10-27", total_minutes: 1620 })).toBe("3 days · Fri 23 Oct – Tue 27 Oct · 27 h");
    expect(planSummary({ day_count: 0, first: null, last: null, total_minutes: 0 })).toBe("No working days found");
    expect(skipText({ date: "2026-12-16", reason: "Day of Reconciliation" })).toBe("Wed 16 Dec · Day of Reconciliation");
    expect(dayBadge(2, 3)).toBe("Day 2/3");
    expect(dayBadge(1, 1)).toBeNull();
  });

  it("day 2 shows 'Day 2 of 3 · Check in', then Done for today; the last day shows Job complete", () => {
    expect(dayAction(run([d1done, day(2, "2026-10-27"), day(3, "2026-10-28")])).label).toBe("Day 2 of 3 · Check in");
    const onSite = run([d1done, day(2, "2026-10-27", { checked_in_at: "2026-10-27T06:00:00Z" }), day(3, "2026-10-28")]);
    expect(dayAction(onSite).kind).toBe("done_for_today");
    const doneDay2 = run([d1done, day(2, "2026-10-27", { checked_in_at: "x", checked_out_at: "y" }), day(3, "2026-10-28")]);
    expect(dayAction(doneDay2)).toMatchObject({ kind: "day_done", sub: "Day 2 of 3 · back Wed 28 Oct" });
    const last = { ...run([d1done, day(2, "2026-10-27", { checked_in_at: "x", checked_out_at: "y" }), day(3, "2026-10-28", { checked_in_at: "z" })]), today: "2026-10-28" };
    expect(dayAction(last).kind).toBe("job_complete");
    expect(dayAction({ ...last, status: "completed" }).kind).toBe("none");
  });

  it("hours: auto-filled to the quarter hour; a change needs a note", () => {
    expect(autoHours("2026-10-27T06:00:00Z", new Date("2026-10-27T13:20:00Z"))).toBe(7.25);
    expect(hoursNeedNote(7.25, 7.25)).toBe(false);
    expect(doneForTodayError(8, 7.25, "")).toMatch(/Say why/);
    expect(doneForTodayError(8, 7.25, "Stayed to finish the pipe run")).toBeNull();
    expect(doneForTodayError(20, 7.25, "x")).toMatch(/between 0 and 16/);
  });

  it("labour = sum of the days; dragging counts only not-yet-worked days", () => {
    const days = [d1done, day(2, "2026-10-27", { hours: 7.5, checked_in_at: "x" }), day(3, "2026-10-28")];
    expect(sumDayHours(days)).toBe(16.5);
    expect(remainingDays(days)).toBe(1);
  });

  it("applyDayOp (offline optimistic): check-in sets in_progress, done-for-today records hours, job stays in progress", () => {
    let d = run([d1done, day(2, "2026-10-27"), day(3, "2026-10-28")], "scheduled");
    d = applyDayOp(d, "tech_check_in", "2026-10-27T06:05:00Z", "2026-10-27");
    expect(d.status).toBe("in_progress");
    expect(d.days[1]).toMatchObject({ checked_in_at: "2026-10-27T06:05:00Z", state: "on_site" });
    d = applyDayOp(d, "tech_done_for_today", "2026-10-27T15:00:00Z", "2026-10-27", 8.5, "Ceiling cassettes hung");
    expect(d.status).toBe("in_progress");
    expect(d.days[1]).toMatchObject({ hours: 8.5, notes: "Ceiling cassettes hung", state: "done" });
    expect(d.labour_hours).toBe(17.5);
    expect(d.days[2].checked_in_at).toBeNull();
  });
});

describe("tech day-by-day view", () => {
  it("renders every day and the Check in button for day 2", () => {
    const onAction = vi.fn();
    render(<JobDaysView data={run([d1done, day(2, "2026-10-27"), day(3, "2026-10-28")])} today="2026-10-27" onAction={onAction} onEnRoute={() => {}} onAddDay={() => {}} />);
    expect(screen.getByTestId("job-days-list").querySelectorAll("li").length).toBe(3);
    fireEvent.click(screen.getByTestId("day-action-check_in"));
    expect(onAction).toHaveBeenCalledWith("check_in");
    expect(screen.getByTestId("day-en-route")).toBeTruthy();
  });

  it("Done for today sheet blocks a changed hours figure without a note", () => {
    const onSubmit = vi.fn();
    render(<DoneForTodaySheet open onOpenChange={() => {}} tag="Day 2 of 3" auto={7} photos={1} techName="Sipho" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByTestId("signoff-confirm"));
    fireEvent.change(screen.getByTestId("done-hours"), { target: { value: "9" } });
    expect((screen.getByTestId("done-submit") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("done-edit-note"), { target: { value: "Finished the commissioning" } });
    expect((screen.getByTestId("done-submit") as HTMLButtonElement).disabled).toBe(false);
  });

  it("each day needs an after photo and the tech's own sign-off; the client signature is optional", () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<DoneForTodaySheet open onOpenChange={() => {}} tag="Day 1 of 3" auto={8} photos={0} techName="Sipho" onSubmit={onSubmit} />);
    const submit = () => screen.getByTestId("done-submit") as HTMLButtonElement;
    expect(submit().disabled).toBe(true);
    expect(screen.getByTestId("done-error").textContent).toMatch(/after photo/);
    rerender(<DoneForTodaySheet open onOpenChange={() => {}} tag="Day 1 of 3" auto={8} photos={2} techName="Sipho" onSubmit={onSubmit} />);
    expect(submit().disabled).toBe(true);
    expect(screen.getByTestId("done-error").textContent).toMatch(/sign off/i);
    fireEvent.click(screen.getByTestId("signoff-confirm"));
    expect((screen.getByTestId("signoff-name") as HTMLInputElement).value).toBe("Sipho");
    expect(screen.getByTestId("tech-signoff").textContent).toContain("Signed Sipho");
    expect(submit().disabled).toBe(false);
    fireEvent.change(screen.getByTestId("signoff-name"), { target: { value: "" } });
    expect(submit().disabled).toBe(true);
    fireEvent.change(screen.getByTestId("signoff-name"), { target: { value: "Sipho M" } });
    fireEvent.click(submit());
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ hours: 8, signoffName: "Sipho M", clientName: "", clientSignature: null }));
  });

  it("a day done offline keeps the sign-off on the day", () => {
    const d = run([day(1, "2026-10-27", { checked_in_at: "2026-10-27T06:00:00Z", state: "on_site" }), day(2, "2026-10-28")]);
    const next = applyDayOp(d, "tech_done_for_today", "2026-10-27T15:00:00Z", "2026-10-27", 9, null, "Sipho");
    expect(next.days[0]).toMatchObject({ state: "done", hours: 9, signed_off_name: "Sipho", signed_off_at: "2026-10-27T15:00:00Z" });
  });
});

describe("multi-day pick", () => {
  const plan: DaysPlan = {
    days: [
      { day_index: 1, date: "2026-10-23", start: "08:00", end: "17:00", minutes: 540 },
      { day_index: 2, date: "2026-10-26", start: "08:00", end: "17:00", minutes: 540, clashes: [{ start: "09:00", end: "11:00", label: "Service call", job_id: null, lead_id: "l1" }] },
    ],
    day_count: 2, skipped: [{ date: "2026-10-24", reason: "Weekend" }, { date: "2026-10-25", reason: "Weekend" }], clash_days: 1, total_minutes: 1080,
    first: "2026-10-23", last: "2026-10-26",
  };
  it("a clash blocks; only an admin with a reason can book anyway", () => {
    expect(multiDayBlocked(plan, false, "")).toMatch(/busy/);
    expect(multiDayBlocked(plan, true, "")).toMatch(/Say why/);
    expect(multiDayBlocked(plan, true, "Client agreed overtime")).toBeNull();
    expect(multiDayBlocked({ ...plan, clash_days: 0 }, false, "")).toBeNull();
  });
  it("shows the days, skipped weekend and the clash", () => {
    render(<MultiDayPickerView days={2} onDaysChange={() => {}} techId="t1" date="2026-10-23" isAdmin reason="" onReasonChange={() => {}} plan={plan} />);
    expect(screen.getByTestId("days-summary").textContent).toContain("2 days · Fri 23 Oct – Mon 26 Oct · 18 h");
    expect(screen.getByTestId("days-skipped").textContent).toContain("Sat 24 Oct · Weekend");
    expect(screen.getAllByTestId("days-plan-clash").length).toBe(1);
    expect(screen.getByTestId("days-override-reason")).toBeTruthy();
  });
});

describe("today's jobs with multi-day runs", () => {
  const sched = (date: string, i: number) => ({ id: `s${i}`, lead_id: "l1", job_id: "j1", agent_id: "t1", scheduled_date: date, start_time: "08:00", day_index: i, day_count: 3, jobs: { status: "in_progress" } });
  it("one tile per day; earlier days are not overdue, a missed last day is", () => {
    const e = buildCalendarEntries([sched("2026-10-23", 1), sched("2026-10-26", 2), sched("2026-10-27", 3)], []);
    expect(e.map((x) => x.key)).toEqual(["job:j1:2026-10-23", "job:j1:2026-10-26", "job:j1:2026-10-27"]);
    expect(overdueEntries(e, "2026-10-27")).toHaveLength(0);
    expect(overdueEntries(e, "2026-10-28").map((x) => x.day_index)).toEqual([3]);
  });
  it("single-day bookings keep one tile per job", () => {
    const e = buildCalendarEntries([{ id: "a", lead_id: "l2", job_id: "j2", agent_id: "t1", scheduled_date: "2026-10-23", start_time: "08:00", jobs: { status: "scheduled" } }], []);
    expect(e[0].key).toBe("job:j2");
  });
});

it("install offers show the run length", () => {
  const t = offerSummary({ offer_id: "o", job_id: "j", client: "C", suburb: "Bryanston", date: "2026-10-26", start: "08:00", minutes: 540, distance_km: 4, respond_by: "", days: 3, until: "2026-10-28" });
  expect(t).toContain("3 days");
  expect(t).toContain("from 08:00");
  expect(t).not.toContain("9 h");
});
