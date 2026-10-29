import { describe, it, expect, vi } from "vitest";
import { pdfStep, nextFrame, PdfTimeoutError } from "@/lib/pdfTimeout";

describe("PDF export timeouts (Q-2026-0052/0053 hang)", () => {
  it("turns a capture that never settles into a clear error", async () => {
    vi.useFakeTimers();
    const p = pdfStep(new Promise(() => {}), 30000, "drawing the quote pages");
    const err = p.catch((e) => e);
    await vi.advanceTimersByTimeAsync(30001);
    const e = (await err) as PdfTimeoutError;
    expect(e).toBeInstanceOf(PdfTimeoutError);
    expect(e.message).toMatch(/PDF timed out while drawing the quote pages/);
    vi.useRealTimers();
  });
  it("passes through values and errors", async () => {
    await expect(pdfStep(Promise.resolve(5), 1000, "x")).resolves.toBe(5);
    await expect(pdfStep(Promise.reject(new Error("boom")), 1000, "x")).rejects.toThrow("boom");
  });
  it("nextFrame resolves even when requestAnimationFrame never fires (hidden tab)", async () => {
    const raf = globalThis.requestAnimationFrame;
    (globalThis as any).requestAnimationFrame = () => 0;
    await expect(nextFrame(20)).resolves.toBeUndefined();
    (globalThis as any).requestAnimationFrame = raf;
  });
});
