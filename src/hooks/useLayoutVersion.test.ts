import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLayoutVersion, readLayoutVersion } from "./useLayoutVersion";
describe("useLayoutVersion", () => {
  beforeEach(() => localStorage.clear());
  it("defaults to new and toggles/persists classic", () => {
    const { result } = renderHook(() => useLayoutVersion());
    expect(result.current.version).toBe("new");
    act(() => result.current.toggle());
    expect(result.current.isClassic).toBe(true);
    expect(readLayoutVersion()).toBe("classic");
    act(() => result.current.setVersion("new"));
    expect(readLayoutVersion()).toBe("new");
  });
});
