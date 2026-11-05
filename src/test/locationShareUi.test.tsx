import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { POPIA_LOCATION_NOTICE, ScheduleHoursForm, suggestionDraft, type ScheduleDraft } from "@/components/availability/LocationShareCard";

function renderForm(draft: ScheduleDraft, onChange = vi.fn()) {
  render(
    <ScheduleHoursForm
      draft={draft}
      onChange={onChange}
      saved={false}
      saving={false}
      onSave={vi.fn()}
      onUseSuggestion={vi.fn()}
    />,
  );
  return onChange;
}

describe("location share hours editor", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows the POPIA notice and starts from the Massair suggestion", () => {
    expect(POPIA_LOCATION_NOTICE).toMatch(/off until you turn it on/i);
    expect(POPIA_LOCATION_NOTICE).toMatch(/POPIA/);
    const draft = suggestionDraft(null);
    expect(draft.days).toEqual([1, 2, 3, 4, 5]);
    expect(draft.start).toBe("07:00");
    expect(draft.end).toBe("18:00");
    expect(draft.timezone).toBe("Africa/Johannesburg");
  });

  it("lets one person pick fewer days, extra days, and different hours", () => {
    const onChange = renderForm(suggestionDraft(null));
    fireEvent.click(screen.getByTestId("schedule-day-1"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ days: [2, 3, 4, 5] }));
    fireEvent.click(screen.getByTestId("schedule-day-6"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ days: [1, 2, 3, 4, 5, 6] }));
    fireEvent.change(screen.getByLabelText("Start time hour"), { target: { value: "08" } });
    fireEvent.change(screen.getByLabelText("End time hour"), { target: { value: "16" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ start: "08:00" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ end: "16:00" }));
  });
});
