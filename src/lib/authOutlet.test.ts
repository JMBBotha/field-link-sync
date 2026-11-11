import { describe, expect, it } from "vitest";
import { authCheckHidesOutlet, authOutletPlan } from "@/lib/authOutlet";

describe("admin outlet on auth refresh", () => {
  it("blocks the outlet for the first check and for a different person", () => {
    expect(authOutletPlan({ authorizedUserId: null, userId: "1e795a9b" }).mode).toBe("blocking");
    expect(authOutletPlan({ authorizedUserId: "1e795a9b", userId: "420c7731" }).mode).toBe("blocking");
    expect(authCheckHidesOutlet("blocking")).toBe(true);
  });

  it("keeps the outlet up when the same person gets a new token", () => {
    const plan = authOutletPlan({ authorizedUserId: "1e795a9b", userId: "1e795a9b" });
    expect(plan.mode).toBe("background");
    expect(authCheckHidesOutlet(plan.mode)).toBe(false);
  });
});
