import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn(async (..._args: unknown[]) => ({ data: { ok: true }, error: null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import { clearLocationShareSnapshot, setLocationShareSnapshot, shareLocationIfAllowed } from "./locationPing";

describe("shareLocationIfAllowed", () => {
  beforeEach(() => {
    rpc.mockClear();
    clearLocationShareSnapshot();
  });

  it("does not upsert when Not available or location sharing is off", async () => {
    setLocationShareSnapshot({ signedIn: true, trackingEnabled: false, status: "available", schedule: null });
    await expect(shareLocationIfAllowed(-33.9, 18.4)).resolves.toBe(false);
    setLocationShareSnapshot({ signedIn: true, trackingEnabled: true, status: "offline", schedule: null });
    await expect(shareLocationIfAllowed(-33.9, 18.4)).resolves.toBe(false);
    setLocationShareSnapshot({ signedIn: true, trackingEnabled: true, status: "busy", schedule: null });
    await expect(shareLocationIfAllowed(-33.9, 18.4)).resolves.toBe(false);
    setLocationShareSnapshot({ signedIn: false, trackingEnabled: true, status: "available", schedule: null });
    await expect(shareLocationIfAllowed(-33.9, 18.4)).resolves.toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("upserts through record_my_location_ping when Available and opted in", async () => {
    setLocationShareSnapshot({ signedIn: true, trackingEnabled: true, status: "available", schedule: null });
    await expect(shareLocationIfAllowed(-33.93, 18.42)).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("record_my_location_ping", { p_lat: -33.93, p_lng: 18.42 });
  });
});
