import { describe, it, expect, beforeEach, vi } from "vitest";
import { feedback, setFeedbackPrefs, isPrimaryAction, feedbackForToast, __resetFeedback, DEFAULT_PREFS } from "@/lib/feedback";
describe("feedback", () => {
  beforeEach(() => { localStorage.clear(); __resetFeedback(false); });
  it("defaults on, quiet", () => { expect(DEFAULT_PREFS).toMatchObject({ buttonSounds: true, alertSounds: true, vibration: true }); expect(DEFAULT_PREFS.volume).toBeLessThan(0.5); });
  it("never plays sound before first gesture", () => { expect(feedback("tap").sound).toBe(false); __resetFeedback(true); expect(feedback("tap").sound).toBe(true); });
  it("respects toggles and vibrates only where supported", () => {
    __resetFeedback(true); const v = vi.fn(() => true); (navigator as any).vibrate = v;
    expect(feedback("alert")).toEqual({ sound: true, haptic: true }); expect(v).toHaveBeenCalledWith([200, 100, 200, 100, 300]);
    setFeedbackPrefs({ vibration: false, alertSounds: false }); expect(feedback("alert")).toEqual({ sound: false, haptic: false });
    delete (navigator as any).vibrate; setFeedbackPrefs({ vibration: true }); expect(feedback("tap").haptic).toBe(false);
  });
  it("detects primary action buttons", () => {
    const mk = (t: string, a: Record<string, string> = {}) => { const b = document.createElement("button"); b.textContent = t; Object.entries(a).forEach(([k, v]) => b.setAttribute(k, v)); return b; };
    expect(isPrimaryAction(mk("Accept quote"))).toBe(true); expect(isPrimaryAction(mk("Mark done"))).toBe(true); expect(isPrimaryAction(mk("Save draft"))).toBe(true);
    expect(isPrimaryAction(mk("Cancel"))).toBe(false); expect(isPrimaryAction(mk("Send", { "data-feedback": "off" }))).toBe(false); expect(isPrimaryAction(mk("Open", { "data-feedback": "tap" }))).toBe(true);
  });
  it("maps toasts", () => { __resetFeedback(true); expect(feedbackForToast({ variant: "destructive", title: "Failed" })).toBe(true); expect(feedbackForToast({ title: "Quote sent" })).toBe(true); expect(feedbackForToast({ title: "Loading" })).toBe(false); });
});
