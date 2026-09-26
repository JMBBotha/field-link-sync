import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const signOut = vi.fn().mockResolvedValue({ error: null });
const from = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signOut: (...a: any[]) => signOut(...a) }, from: (...a: any[]) => from(...a) },
}));
const navigate = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));

import { withTimeout } from "@/lib/withTimeout";
import { resolvePostLoginPath } from "@/lib/postLoginRedirect";
import { renderHook } from "@testing-library/react";
import { useIdleLogout } from "@/hooks/useIdleLogout";

describe("sign-in never hangs", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("withTimeout rejects after ms", async () => {
    const p = withTimeout(new Promise(() => {}), 1000, "too slow");
    const assertion = expect(p).rejects.toThrow("too slow");
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("withTimeout passes through fast results", async () => {
    await expect(withTimeout(Promise.resolve(5), 1000, "x")).resolves.toBe(5);
  });

  it("post-login falls back to /admin with an error when profile query never resolves", async () => {
    from.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: () => new Promise(() => {}) }) }),
    });
    const p = resolvePostLoginPath("u1", 8000);
    await vi.advanceTimersByTimeAsync(8000);
    const r = await p;
    expect(r.path).toBe("/admin");
    expect(r.error).toMatch(/taking too long/);
  });

  it("idle logout uses local scope and goes to /login", async () => {
    renderHook(() => useIdleLogout());
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 10);
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(navigate).toHaveBeenCalledWith("/login");
  });
});
