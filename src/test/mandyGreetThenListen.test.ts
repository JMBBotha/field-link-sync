import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { greetThenListen } from "@/lib/mandy/greetThenListen";

describe("greetThenListen", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const mk = () => {
    const order: string[] = [];
    return {
      order,
      beep: vi.fn(() => order.push("beep")),
      startListening: vi.fn(() => { order.push("listen"); }),
    };
  };

  it("greeting ends, then beep, then listen", async () => {
    const m = mk();
    const p = greetThenListen({
      ...m, greeted: { current: false }, isCancelled: () => false,
      speak: (started) => new Promise((r) => { m.order.push("speak"); started(); setTimeout(() => { m.order.push("ended"); r(); }, 1500); }),
    });
    await vi.advanceTimersByTimeAsync(1500);
    expect(await p).toBe("listened");
    expect(m.order).toEqual(["speak", "ended", "beep", "listen"]);
  });

  it("speak rejects → listens immediately", async () => {
    const m = mk();
    const out = await greetThenListen({ ...m, greeted: { current: false }, isCancelled: () => false, speak: () => Promise.reject(new Error("tts")) });
    expect(out).toBe("listened-fallback");
    expect(m.startListening).toHaveBeenCalledOnce();
  });

  it("speak hangs past the timeout → listens", async () => {
    const m = mk();
    const p = greetThenListen({ ...m, greeted: { current: false }, isCancelled: () => false, speak: () => new Promise(() => {}), timeoutMs: 4000 });
    await vi.advanceTimersByTimeAsync(3999);
    expect(m.startListening).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toBe("listened-fallback");
  });

  it("cancelled mid-greeting → no listen, no beep", async () => {
    const m = mk();
    let cancelled = false;
    const p = greetThenListen({
      ...m, greeted: { current: false }, isCancelled: () => cancelled,
      speak: (started) => new Promise((r) => { started(); setTimeout(r, 1000); }),
    });
    cancelled = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toBe("cancelled");
    expect(m.startListening).not.toHaveBeenCalled();
    expect(m.beep).not.toHaveBeenCalled();
  });

  it("buffer arrives after the timeout fallback → listen at 4 s, no play", async () => {
    const m = mk();
    const play = vi.fn();
    const p = greetThenListen({
      ...m, greeted: { current: false }, isCancelled: () => false, timeoutMs: 4000,
      speak: (_started, shouldPlay) => new Promise<void>((r) => {
        setTimeout(() => { if (shouldPlay()) play(); r(); }, 5000); // buffer resolves at 5 s
      }),
    });
    await vi.advanceTimersByTimeAsync(4000);
    expect(m.startListening).toHaveBeenCalledOnce(); // mic opened at the 4 s fallback
    await vi.advanceTimersByTimeAsync(1000); // buffer arrives at 5 s
    expect(await p).toBe("listened-fallback");
    expect(play).not.toHaveBeenCalled(); // abandoned greeting never plays
  });

  it("second turn in the same session → no greeting", async () => {
    const m = mk();
    const greeted = { current: false };
    const speak = vi.fn(() => Promise.resolve());
    await greetThenListen({ ...m, greeted, isCancelled: () => false, speak });
    await greetThenListen({ ...m, greeted, isCancelled: () => false, speak });
    expect(speak).toHaveBeenCalledTimes(1);
    expect(m.startListening).toHaveBeenCalledTimes(2);
  });
});
