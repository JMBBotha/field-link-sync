import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// Plain function (not vi.fn) so a handled rejection isn't reported by the mock tracker.
const calls: unknown[][] = [];
let impl: (...a: unknown[]) => Promise<unknown> = async () => ({ data: null, error: null });
const rpc = {
  mockResolvedValue: (v: unknown) => { impl = async () => v; },
  mockImplementation: (f: (...a: unknown[]) => Promise<unknown>) => { impl = f; },
  mockReset: () => { calls.length = 0; impl = async () => ({ data: null, error: null }); },
};
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => { calls.push(a); return impl(...a); } } }));
import { redirectIfPasswordMissing, inviteOptionKey } from "@/lib/invitePassword";

const loc = (pathname: string) => ({ pathname, replace: vi.fn() });

describe("Q4 team invites: invitee without a password lands on /set-password", () => {
  beforeEach(() => rpc.mockReset());

  it("redirects when the account has no password yet", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const l = loc("/");
    expect(await redirectIfPasswordMissing(l)).toBe(true);
    expect(calls).toContainEqual(["me_needs_password"]);
    expect(l.replace).toHaveBeenCalledWith("/set-password");
  });

  it("does nothing for normal accounts, on /set-password, or when the check fails", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const a = loc("/admin"); expect(await redirectIfPasswordMissing(a)).toBe(false); expect(a.replace).not.toHaveBeenCalled();
    const b = loc("/set-password"); expect(await redirectIfPasswordMissing(b)).toBe(false); expect(calls.length).toBe(1);
    rpc.mockResolvedValue({ data: null, error: { message: "function does not exist" } });
    const c = loc("/field"); expect(await redirectIfPasswordMissing(c)).toBe(false); expect(c.replace).not.toHaveBeenCalled();
  });

  it("never throws when the check itself fails (offline)", async () => {
    rpc.mockImplementation(async () => { throw new Error("offline"); });
    const l = loc("/field");
    await expect(redirectIfPasswordMissing(l)).resolves.toBe(false);
    expect(l.replace).not.toHaveBeenCalled();
  });

  it("maps pending invites back to the dialog option", () => {
    expect(inviteOptionKey({ role: "dispatcher", dispatch_role: "sales" })).toBe("sales");
    expect(inviteOptionKey({ role: "dispatcher", dispatch_role: null })).toBe("dispatcher");
    expect(inviteOptionKey({ role: "field_agent", dispatch_role: "technician" })).toBe("field_agent");
  });

  it("Team page lists pending invites with Resend; AuthContext runs the check", () => {
    const team = readFileSync(resolve(__dirname, "../pages/admin/AdminTeamPage.tsx"), "utf8");
    expect(team).toContain('data-testid="pending-invites"');
    expect(team).toContain("Resend link");
    expect(team).toMatch(/\.from\("team_invites"\)\s*\.select\("id, email, role, dispatch_role, created_at"\)/);
    expect(readFileSync(resolve(__dirname, "../contexts/AuthContext.tsx"), "utf8")).toContain("redirectIfPasswordMissing()");
  });
});
