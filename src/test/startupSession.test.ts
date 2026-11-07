import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { restoreStartupSession, SESSION_RESTORE_TIMEOUT_MESSAGE } from "@/lib/startupSession";

describe("startup session restore cannot hang", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns the session when getSession resolves", async () => {
    const session = { user: { id: "u1" } } as never;
    await expect(
      restoreStartupSession(async () => ({ data: { session } }), 1000),
    ).resolves.toEqual({ session, error: null });
  });

  it("stays unsigned when getSession rejects and does not throw", async () => {
    const result = await restoreStartupSession(
      () => Promise.reject(new Error("storage blocked")),
      1000,
    );
    expect(result.session).toBeNull();
    expect(result.error).toMatch(/storage blocked/);
  });

  it("stays unsigned when getSession never settles", async () => {
    const pending = restoreStartupSession(() => new Promise(() => {}), 1000);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await pending;
    expect(result.session).toBeNull();
    expect(result.error).toBe(SESSION_RESTORE_TIMEOUT_MESSAGE);
  });
});
