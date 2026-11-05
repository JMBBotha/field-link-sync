import { beforeEach, describe, expect, it, vi } from "vitest";
import { mayShareLocation, type ShareSnapshot } from "./availabilitySchedule";
import { resetBackgroundShareGeneration, syncBackgroundShare } from "./backgroundShare";

const now = new Date("2026-11-05T08:00:00.000Z");

function snap(over: Partial<ShareSnapshot> = {}): ShareSnapshot {
  return { signedIn: true, trackingEnabled: true, status: "available", schedule: null, ...over };
}

describe("background service follows Available", () => {
  beforeEach(() => resetBackgroundShareGeneration());

  it("does not start when the app is installed but the person is Not available or sharing is off", async () => {
    const start = vi.fn(async () => {});
    const stop = vi.fn(async () => {});
    expect(mayShareLocation(snap({ status: "offline" }), now)).toBe(false);
    expect(mayShareLocation(snap({ trackingEnabled: false }), now)).toBe(false);
    await expect(syncBackgroundShare(snap({ status: "offline" }), now, { start, stop })).resolves.toBe("stopped");
    await expect(syncBackgroundShare(snap({ trackingEnabled: false }), now, { start, stop })).resolves.toBe("stopped");
    await expect(syncBackgroundShare(snap({ signedIn: false }), now, { start, stop })).resolves.toBe("stopped");
    expect(start).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledTimes(3);
  });

  it("starts only while Available and opted in, and a later stop wins a slow start", async () => {
    let release: () => void = () => {};
    const start = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const stop = vi.fn(async () => {});
    const pending = syncBackgroundShare(snap(), now, { start, stop });
    const stopped = syncBackgroundShare(snap({ status: "offline" }), now, { start, stop });
    release();
    await expect(pending).resolves.toBe("stopped");
    await expect(stopped).resolves.toBe("stopped");
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalled();
  });
});
