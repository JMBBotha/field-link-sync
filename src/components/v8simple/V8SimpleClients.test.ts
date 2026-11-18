import { describe, it, expect } from "vitest";
import { v8HouseBooking } from "@/components/v8simple/V8SimpleClients";

describe("clients house booking", () => {
  it("attaches a house visit to the one installation job", () => {
    const plan = v8HouseBooking();
    expect(plan.attached).toBe(true);
    expect(plan.createSecondJob).toBe(false);
    expect(plan.newSale).toBe(false);
    expect(plan.job?.id).toBe("install-12");
  });
});
