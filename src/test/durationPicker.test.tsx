import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DurationPickerView } from "@/components/scheduling/DurationPicker";
import { describeDuration, durationChips, formatDuration, maxMinutesFrom, stepDuration } from "@/lib/durationOptions";
import { endTimeFor, quoteLabourMinutes } from "@/lib/schedulingDefaults";
import { toCompanyHours } from "@/hooks/useCompanyHours";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const hours = toCompanyHours({ work_days: [1, 2, 3, 4, 5], work_start: "08:00:00", work_end: "17:00:00" });

describe("duration options (phase a, 23 Oct 2026)", () => {
  it("Full day = company hours (9 h for 08:00–17:00), no 2-day chip", () => {
    expect(hours.fullDayMinutes).toBe(540);
    const chips = durationChips(hours.fullDayMinutes);
    expect(chips.map((c) => c.minutes)).toEqual([60, 120, 240, 540]);
    expect(chips.some((c) => /2 days/.test(c.label))).toBe(false);
    expect(chips[3].label).toBe("Full day (9 h)");
    expect(toCompanyHours({ work_start: "07:30", work_end: "16:00", work_days: [1] }).fullDayMinutes).toBe(510);
  });
  it("half-hour stepper snaps and clamps", () => {
    expect(stepDuration(180, 1)).toBe(210);
    expect(stepDuration(180, -1)).toBe(150);
    expect(stepDuration(45, 1)).toBe(60);
    expect(stepDuration(30, -1)).toBe(30);
    expect(stepDuration(700, 1, 720)).toBe(720);
    expect(stepDuration(720, 1, 720)).toBe(720);
  });
  it("formats", () => {
    expect(formatDuration(180)).toBe("3 h");
    expect(formatDuration(210)).toBe("3 h 30");
    expect(formatDuration(45)).toBe("45 min");
  });
  it("end time never wraps past midnight", () => {
    expect(endTimeFor("22:00", 180)).toEqual({ end: "23:59", clamped: true });
    expect(endTimeFor("08:00", 540)).toEqual({ end: "17:00", clamped: false });
    expect(maxMinutesFrom("22:00")).toBe(119);
    expect(maxMinutesFrom(null)).toBe(720);
  });
  it("warns when a single day runs past company hours", () => {
    const ok = describeDuration({ start: "08:00", minutes: 540, workStart: "08:00", workEnd: "17:00", fullDayMinutes: 540 });
    expect(ok).toEqual({ end: "17:00", warnings: [] });
    const late = describeDuration({ start: "14:00", minutes: 240, workStart: "08:00", workEnd: "17:00", fullDayMinutes: 540 });
    expect(late.end).toBe("18:00");
    expect(late.warnings.map((w) => w.kind)).toEqual(["after_hours"]);
    const long = describeDuration({ start: null, minutes: 600, workStart: "08:00", workEnd: "17:00", fullDayMinutes: 540 });
    expect(long.warnings.map((w) => w.kind)).toEqual(["longer_than_day"]);
    const wrap = describeDuration({ start: "22:00", minutes: 180, workStart: "08:00", workEnd: "17:00", fullDayMinutes: 540 });
    expect(wrap.end).toBe("23:59");
    expect(wrap.warnings.map((w) => w.kind)).toContain("clamped");
  });
  it("quote labour beats the default, rounded to half hours, 30 min–12 h", () => {
    expect(quoteLabourMinutes(3.5)).toBe(210);
    expect(quoteLabourMinutes(0)).toBeNull();
    expect(quoteLabourMinutes(null)).toBeNull();
    expect(quoteLabourMinutes(0.2)).toBe(30);
    expect(quoteLabourMinutes(20)).toBe(720);
  });
});

describe("<DurationPickerView>", () => {
  it("chips, stepper, ends-at and after-hours warning", () => {
    const onChange = vi.fn();
    const { rerender } = render(<DurationPickerView value={180} onChange={onChange} startTime="08:00" hours={hours} hint="Default 3 h" />);
    expect(screen.getByTestId("duration-value").textContent).toBe("3 h");
    expect(screen.getByTestId("duration-ends").textContent).toBe("ends 11:00");
    expect(screen.getByTestId("duration-hint").textContent).toBe("Default 3 h");
    fireEvent.click(screen.getByRole("radio", { name: "Full day (9 h)" }));
    expect(onChange).toHaveBeenLastCalledWith(540);
    fireEvent.click(screen.getByLabelText("Half an hour more"));
    expect(onChange).toHaveBeenLastCalledWith(210);
    expect(screen.queryByTestId("duration-warning-after_hours")).toBeNull();
    rerender(<DurationPickerView value={240} onChange={onChange} startTime="15:00" hours={hours} />);
    expect(screen.getByTestId("duration-warning-after_hours").textContent).toMatch(/after company hours \(17:00\)/);
  });
  it("disables lengths that would run past midnight", () => {
    render(<DurationPickerView value={60} onChange={vi.fn()} startTime="21:00" hours={hours} />);
    expect((screen.getByRole("radio", { name: "4 h" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("radio", { name: "2 h" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
