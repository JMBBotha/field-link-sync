import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { playOnElement, armUtteranceEnd, synthSafetyMs } from "@/lib/mandy/voiceUnlock";

class FakeAudio extends EventTarget {
  src = "";
  currentTime = 0;
  duration = NaN;
  playImpl: () => Promise<void> = () => Promise.resolve();
  play = vi.fn(() => this.playImpl());
  pause = vi.fn(() => { this.dispatchEvent(new Event("pause")); });
}

describe("voiceUnlock playback detection", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("started=true on 'playing'", async () => {
    const el = new FakeAudio();
    const h = playOnElement(el as unknown as HTMLAudioElement, "x.mp3");
    el.dispatchEvent(new Event("playing"));
    await expect(h.started).resolves.toBe(true);
    el.dispatchEvent(new Event("ended"));
    await expect(h.ended).resolves.toBeUndefined();
  });

  it("started=false after 2500 ms with no real playback", async () => {
    const el = new FakeAudio();
    const h = playOnElement(el as unknown as HTMLAudioElement, "x.mp3");
    let v: boolean | undefined;
    void h.started.then((b) => { v = b; });
    await vi.advanceTimersByTimeAsync(2499);
    expect(v).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2);
    expect(v).toBe(false);
    expect(el.pause).toHaveBeenCalled();
  });

  it("play() rejection → started=false", async () => {
    const el = new FakeAudio();
    el.playImpl = () => Promise.reject(new Error("NotAllowedError"));
    const h = playOnElement(el as unknown as HTMLAudioElement, "x.mp3");
    await expect(h.started).resolves.toBe(false);
  });
});

describe("speechSynthesis fallback end callback", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires once on onend even when the safety timer also elapses", () => {
    const u = { onend: null as any, onerror: null as any };
    const onEnd = vi.fn();
    armUtteranceEnd(u, 20, onEnd);
    u.onend();
    u.onerror();
    vi.advanceTimersByTime(synthSafetyMs(20) + 10);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("fires via the safety timer when iOS never calls onend", () => {
    const u = { onend: null as any, onerror: null as any };
    const onEnd = vi.fn();
    armUtteranceEnd(u, 10, onEnd);
    vi.advanceTimersByTime(synthSafetyMs(10));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
