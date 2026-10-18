import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const stop = vi.fn(async () => ({ base64: "AAAA", bytes: 20000 }));
const cancel = vi.fn();
vi.mock("@/lib/wavRecorder", () => ({ WavRecorder: class { start = vi.fn(async () => {}); stop = stop; cancel = cancel; } }));
vi.mock("@/hooks/useSiteSurvey", () => ({ useSurveyFileUrl: () => null }));
import { HoldToRecordButton, CANCEL_PX } from "@/components/survey/VoiceNotes";

if (!(globalThis as any).PointerEvent) {
  (globalThis as any).PointerEvent = class extends MouseEvent { pointerId: number; constructor(t: string, i: any = {}) { super(t, i); this.pointerId = i.pointerId ?? 1; } };
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe("R6 hold-to-record", () => {
  beforeEach(() => { stop.mockClear(); cancel.mockClear(); vi.useRealTimers(); });
  it("hold then release saves to the photo with a done state", async () => {
    const onDone = vi.fn();
    render(<HoldToRecordButton onDone={onDone} testId="b" />);
    const b = screen.getByTestId("b");
    const now = Date.now(); const spy = vi.spyOn(Date, "now").mockReturnValue(now);
    fireEvent.pointerDown(b, { clientX: 200, pointerId: 1 }); await flush();
    expect(b.dataset.state).toBe("recording");
    spy.mockReturnValue(now + 12000);
    fireEvent.pointerUp(b, { clientX: 200, pointerId: 1 }); await flush();
    expect(onDone).toHaveBeenCalledWith("AAAA", 20000);
    expect(b.textContent).toContain("Voice note saved to photo · 0:12");
    spy.mockRestore();
  });
  it("slide left past the cancel line discards", async () => {
    const onDone = vi.fn();
    render(<HoldToRecordButton onDone={onDone} testId="b" />);
    const b = screen.getByTestId("b");
    fireEvent.pointerDown(b, { clientX: 300, pointerId: 1 }); await flush();
    fireEvent.pointerMove(b, { clientX: 300 - CANCEL_PX - 5, pointerId: 1 });
    expect(b.textContent).toContain("Release to cancel");
    fireEvent.pointerUp(b, { pointerId: 1 }); await flush();
    expect(cancel).toHaveBeenCalled(); expect(onDone).not.toHaveBeenCalled();
    expect(b.textContent).toContain("Deleted");
  });
  it("tap fallback: tap starts, tap stops and saves", async () => {
    const onDone = vi.fn();
    render(<HoldToRecordButton onDone={onDone} testId="b" />);
    const b = screen.getByTestId("b");
    fireEvent.pointerDown(b, { clientX: 100, pointerId: 1 }); fireEvent.pointerUp(b, { pointerId: 1 }); await flush();
    expect(b.dataset.state).toBe("tap");
    fireEvent.pointerDown(b, { clientX: 100, pointerId: 1 }); await flush();
    expect(onDone).toHaveBeenCalled();
  });
});
