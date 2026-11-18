import { describe, it, expect } from "vitest";
import { v8HouseBooking } from "@/components/v8simple/V8SimpleClients";
import { V8_DEMO_ESTATE_PAYER } from "@/lib/v8simple/clientPay";

describe("clients house booking", () => {
  it("attaches a house visit to the one installation job", () => {
    const plan = v8HouseBooking();
    expect(plan.attached).toBe(true);
    expect(plan.createSecondJob).toBe(false);
    expect(plan.newSale).toBe(false);
    expect(plan.job?.id).toBe("install-12");
    expect(V8_DEMO_ESTATE_PAYER.name).toBe("Demo Estate accounts");
    expect(V8_DEMO_ESTATE_PAYER.source).toBe("projects.customer_id");
  });
});
