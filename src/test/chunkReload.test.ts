import { describe, it, expect, beforeEach, vi } from "vitest";
import { isChunkLoadError, reloadOnceForStaleChunk, importWithRetry } from "@/lib/chunkReload";

describe("stale chunk reload", () => {
  beforeEach(() => { sessionStorage.clear(); });
  it("detects Safari/Chrome/Firefox chunk errors", () => {
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: x.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("error loading dynamically imported module"))).toBe(true);
    expect(isChunkLoadError(new Error("x is undefined"))).toBe(false);
  });
  it("reloads once, then not again within 30s", () => {
    const replace = vi.fn();
    Object.defineProperty(window, "location", { value: { href: "http://x/admin", replace }, writable: true });
    expect(reloadOnceForStaleChunk()).toBe(true);
    expect(reloadOnceForStaleChunk()).toBe(false);
    expect(replace).toHaveBeenCalledTimes(1);
  });
  it("retries an import before giving up", async () => {
    let n = 0;
    const v = await importWithRetry(async () => { if (n++ < 1) throw new Error("blip"); return 7; }, 2);
    expect(v).toBe(7);
  });
});
