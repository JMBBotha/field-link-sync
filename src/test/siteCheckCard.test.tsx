import { describe, it, expect } from "vitest";
import { siteCheckBlock, type SiteCheckInfo } from "@/components/field/SiteCheckCard";

const base: SiteCheckInfo = { needs_check: true, has_install: true, remote_quote: true, status: null, locked_at: null, last_result: null, last_checked_at: null, rooms: [], quick_adds: [], variation: null };
describe("site check gate on Start/Complete", () => {
  it("blocks until confirmed on remote install jobs", () => {
    expect(siteCheckBlock(base)).toBe("Do the site check first.");
    expect(siteCheckBlock({ ...base, status: "awaiting_client" })).toMatch(/client to approve/);
    expect(siteCheckBlock({ ...base, status: "awaiting_pricing" })).toMatch(/office to price/);
    expect(siteCheckBlock({ ...base, status: "declined" })).toBe("Client declined – do not proceed.");
    expect(siteCheckBlock({ ...base, status: "confirmed" })).toBeNull();
  });
  it("never blocks jobs that don't need a check", () => {
    expect(siteCheckBlock({ ...base, needs_check: false })).toBeNull();
    expect(siteCheckBlock(undefined)).toBeNull();
  });
});
