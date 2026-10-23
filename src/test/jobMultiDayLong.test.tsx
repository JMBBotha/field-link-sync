import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/contexts/OfflineContext", () => ({ useOfflineContext: () => ({ isOnline: true, queueOperation: vi.fn(), syncPendingOperations: vi.fn() }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "t1" } }) }));
vi.mock("@/hooks/useSignedInIdentity", () => ({ useSignedInIdentity: () => ({ name: "Sipho", role: "tech", pending: false }) }));

import {
  MAX_PICK_DAYS, addDaysISO, clashHeadline, clashSummaryOf, dayBadgeTitle, pickArgs, pickEndDate, pickLabel, planSummary, rangeLabel, runProgress, visibleDayWindow,
  type DaysPlan, type JobDay, type JobDays, type PlanDay,
} from "@/lib/jobDays";
import { JobDaysView } from "@/components/field/JobDaysPanel";
import { MultiDayPickerView } from "@/components/scheduling/MultiDayPicker";
import { JobRunCardView } from "@/components/scheduling/JobRunCard";

/** Working days (Mon–Fri) from a start date, skipping the given holidays. */
function weekdays(start: string, n: number, skip: string[] = []): string[] {
  const out: string[] = []; let d = start;
  while (out.length < n) { const dow = new Date(`${d}T12:00:00Z`).getUTCDay(); if (dow > 0 && dow < 6 && !skip.includes(d)) out.push(d); d = addDaysISO(d, 1); }
  return out;
}
const HOL = ["2026-12-16", "2026-12-25", "2027-01-01"];
const longRun = (n: number, today: string): JobDays => {
  const dates = weekdays("2026-11-02", n, HOL);
  const days: JobDay[] = dates.map((date, i) => ({
    schedule_id: `s${i + 1}`, day_index: i + 1, day_count: n, date, start: "08:00", end: "17:00", agent_id: "t1",
    en_route_at: null, checked_in_at: date < today ? `${date}T06:00:00Z` : null, checked_out_at: date < today ? `${date}T15:00:00Z` : null,
    hours: date < today ? 9 : null, hours_auto: null, hours_edit_note: null, notes: null, state: date < today ? "done" : date === today ? "today" : "upcoming",
  }));
  return { job_id: "j1", status: "in_progress", today, multi_day: true, day_count: n, scheduled_until: null, days, labour_hours: 0 };
};

describe("long runs: picks and end dates", () => {
  it("allows up to 130 working days (about 6 months)", () => expect(MAX_PICK_DAYS).toBe(130));
  it("turns weeks and months into an end date (calendar, inclusive)", () => {
    expect(pickEndDate("2026-11-02", { kind: "weeks", n: 1 })).toBe("2026-11-08");
    expect(pickEndDate("2026-11-02", { kind: "weeks", n: 3 })).toBe("2026-11-22");
    expect(pickEndDate("2026-11-02", { kind: "months", n: 1 })).toBe("2026-12-01");
    expect(pickEndDate("2026-11-02", { kind: "months", n: 3 })).toBe("2027-02-01");
    expect(pickEndDate("2027-01-31", { kind: "months", n: 1 })).toBe("2027-02-28");
    expect(pickEndDate("2026-11-02", { kind: "days", n: 5 })).toBeNull();
    expect(pickArgs("2026-11-02", { kind: "days", n: 5 })).toEqual({ days: 5, end: null });
    expect(pickArgs("2026-11-02", { kind: "until", end: "2027-01-29" })).toEqual({ days: null, end: "2027-01-29" });
    expect(pickLabel({ kind: "months", n: 2 })).toBe("2 months");
    expect(pickLabel({ kind: "until", end: "2027-01-29" })).toBe("Until Fri 29 Jan");
  });
  it("shows the year when a run crosses into the next year", () => {
    expect(rangeLabel("2026-11-02", "2026-11-30")).toBe("Mon 2 Nov – Mon 30 Nov");
    expect(rangeLabel("2026-11-02", "2027-02-03")).toBe("Mon 2 Nov 2026 – Wed 3 Feb 2027");
    expect(planSummary({ day_count: 65, first: "2026-11-02", last: "2027-02-03", total_minutes: 65 * 540 })).toBe("65 days · Mon 2 Nov 2026 – Wed 3 Feb 2027 · 585 h");
  });
});

describe("long runs: progress (Day N of M)", () => {
  it("Day 23 of 44 with % done and the expected end", () => {
    const dates = weekdays("2026-11-02", 44, HOL);
    const r = longRun(44, dates[22]);
    const p = runProgress(r);
    expect(p.headline).toBe("Day 23 of 44");
    expect(p.done).toBe(22);
    expect(p.pct).toBe(50);
    expect(p.expectedEnd).toBe(dates[43]);
    expect(p.sub).toMatch(/^ends /);
  });
  it("before the start, between days and when finished", () => {
    const r = longRun(10, "2026-10-30");
    expect(runProgress(r).headline).toBe("Starts Mon 2 Nov");
    expect(runProgress(r, "2026-11-07").headline).toBe("Next: Day 6 of 10");
    expect(runProgress({ ...r, status: "completed" }).pct).toBe(100);
  });
  it("folds a long day list to a window around today", () => {
    const r = longRun(44, weekdays("2026-11-02", 44, HOL)[22]);
    expect(visibleDayWindow(r.days, r.today)).toEqual({ from: 20, to: 27 });
    expect(visibleDayWindow(r.days.slice(0, 3), r.today)).toEqual({ from: 0, to: 3 });
    expect(dayBadgeTitle(23, 44, "2027-01-08")).toBe("Day 23 of 44 · ends Fri 8 Jan");
  });
});

describe("long runs: screens", () => {
  it("tech list: progress header, folded rows and Show all", () => {
    const today = weekdays("2026-11-02", 44, HOL)[22];
    render(<JobDaysView data={longRun(44, today)} today={today} onAction={() => {}} />);
    expect(screen.getByTestId("run-progress-headline").textContent).toBe("Day 23 of 44");
    expect(screen.getByTestId("run-progress-pct").textContent).toBe("50%");
    expect(within(screen.getByTestId("job-days-list")).getAllByRole("listitem")).toHaveLength(7);
    expect(screen.getByTestId("job-days-before").textContent).toMatch(/Day 1–20 · 20 of 20 done/);
    expect(screen.getByTestId("job-days-after").textContent).toMatch(/Day 28–44 · 17 more days/);
    fireEvent.click(screen.getByTestId("job-days-toggle"));
    expect(within(screen.getByTestId("job-days-list")).getAllByRole("listitem")).toHaveLength(44);
  });
  it("office card: progress and one dot per day", () => {
    const today = weekdays("2026-11-02", 44, HOL)[22];
    render(<JobRunCardView data={longRun(44, today)} />);
    expect(screen.getByTestId("run-progress-headline").textContent).toBe("Day 23 of 44");
    expect(screen.getByTestId("job-run-dots").children).toHaveLength(44);
    expect(screen.getByTestId("job-run-range").textContent).toMatch(/Mon 2 Nov 2026 – .* 2027/);
  });
});

describe("long runs: clash summary", () => {
  const dates = weekdays("2026-11-02", 65, HOL);
  const pd = (date: string, i: number, clash?: string): PlanDay => ({ day_index: i + 1, date, start: "08:00", end: "17:00", minutes: 540,
    clashes: clash ? [{ start: "09:00", end: "11:00", label: clash }] as PlanDay["clashes"] : [] });
  const clashAt = new Set([6, 11, 16, 21, 26, 31, 36, 41, 46, 51, 56, 61]);
  const plan: DaysPlan = {
    days: dates.map((d, i) => pd(d, i, clashAt.has(i) ? (i < 40 ? "TEST Clash Client" : "TEST Other Client") : undefined)),
    day_count: 65, skipped: [], clash_days: 12, total_minutes: 65 * 540, first: dates[0], last: dates[64],
  };
  it("groups clash days by booking when the server sends no summary", () => {
    const s = clashSummaryOf(plan)!;
    expect(s.days).toBe(12);
    expect(s.by_label.map((g) => [g.label, g.days])).toEqual([["TEST Clash Client", 7], ["TEST Other Client", 5]]);
    expect(s.dates).toHaveLength(12);
    expect(clashHeadline(s, 65)).toMatch(/^Busy on 12 of the 65 days \(/);
  });
  it("picker: folds the plan to 5 days, shows grouped clashes and the reason box", () => {
    render(<MultiDayPickerView days={65} onDaysChange={() => {}} techId="t1" date={dates[0]} isAdmin reason="" onReasonChange={() => {}} plan={plan}
      pick={{ kind: "months", n: 3 }} onPick={() => {}} />);
    expect(screen.getByTestId("days-value").textContent).toBe("3 months · 65 working days");
    expect(within(screen.getByTestId("days-plan")).getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByTestId("days-plan-toggle").textContent).toMatch(/\+ 60 more days/);
    expect(screen.getByTestId("days-clash-groups").textContent).toMatch(/TEST Clash Client · 7 days/);
    expect(screen.getByTestId("days-override-reason")).toBeTruthy();
    expect(screen.getByTestId("days-quick-m3").getAttribute("aria-pressed")).toBe("true");
  });
  it("picker: warns when holidays are not loaded that far, hints Pick for long offers", () => {
    render(<MultiDayPickerView days={65} onDaysChange={() => {}} techId={null} offer date={dates[0]} isAdmin={false} reason="" onReasonChange={() => {}}
      plan={{ ...plan, clash_days: 0, days: plan.days.map((d) => ({ ...d, clashes: [] })), holidays_unknown: true, holidays_known_until: "2028-12-26" }} />);
    expect(screen.getByTestId("days-holidays-unknown").textContent).toMatch(/Tue 26 Dec 2028/);
    expect(screen.getByTestId("days-offer-hint").textContent).toMatch(/Pick a technician instead/);
  });
  it("quick picks: days set the count, weeks/months/until go through onPick", () => {
    const onDays = vi.fn(); const onPick = vi.fn();
    render(<MultiDayPickerView days={2} onDaysChange={onDays} techId="t1" date="2026-11-02" isAdmin reason="" onReasonChange={() => {}} plan={null}
      pick={{ kind: "days", n: 2 }} onPick={onPick} />);
    fireEvent.click(screen.getByTestId("days-quick-d5")); expect(onDays).toHaveBeenCalledWith(5);
    fireEvent.click(screen.getByTestId("days-quick-w2")); expect(onPick).toHaveBeenCalledWith({ kind: "weeks", n: 2 });
    fireEvent.change(screen.getByTestId("days-until"), { target: { value: "2027-01-29" } });
    expect(onPick).toHaveBeenCalledWith({ kind: "until", end: "2027-01-29" });
  });
});
