import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { V8_CLIENT_DEPOSIT_PERCENT, V8_DEMO_ESTATE_PAYER, v8ClientButton, v8ClientPayPage, v8DepositAmount, v8EftInstructions, v8HousePayTarget, v8YocoSandbox } from "@/lib/v8simple/clientPay";

describe("client pay page", () => {
  it("takes the same deposit on a repair quote and shows a developer house", () => {
    expect(V8_CLIENT_DEPOSIT_PERCENT).toBe(70);
    expect(v8DepositAmount(10000, 70)).toBe(7000);
    expect(v8DepositAmount(11420, 70)).toBe(7994);
    expect(v8ClientPayPage({ kind: "repair" })).toBe(true);
    expect(v8ClientPayPage({ kind: "developer" })).toBe(true);
    expect(v8ClientButton({ quoteNo: "Q-R1", kind: "repair", total: 4000 })).toBe("Accept & pay deposit");
  });

  it("marks a sandbox Yoco success as paid and leaves EFT waiting", () => {
    const paid = v8YocoSandbox({ status: "succeeded", amount: 7000, quoteNo: "Q-1048" });
    expect(paid.depositPaid).toBe(true);
    expect(paid.environment).toBe("sandbox");
    expect(paid.gateway).toBe("yoco");
    expect(v8YocoSandbox({ status: "failed", amount: 7000, quoteNo: "Q-1048" }).depositPaid).toBe(false);
    const eft = v8EftInstructions("Q-1048");
    expect(eft.reference).toBe("Q-1048");
    expect(eft.status).toBe("waiting for EFT");
    expect(v8ClientButton({ quoteNo: "Q-1048", kind: "install", total: 10000, eftWaiting: true })).toBe("Waiting for EFT");
  });

  it("sends a house pay link to the project customer, not the occupant", () => {
    expect(V8_DEMO_ESTATE_PAYER.source).toBe("projects.customer_id");
    expect(V8_DEMO_ESTATE_PAYER.name).toBe("Demo Estate accounts");
    expect(V8_DEMO_ESTATE_PAYER.name).not.toBe("House 12 resident");
    const again = v8HousePayTarget({
      houseNo: "12",
      occupantName: "House 12 resident",
      projectCustomer: { id: "cust-demo-estate", name: "Demo Estate accounts", email: "accounts@demo-estate.example" },
    });
    expect(again.customerId).toBe("cust-demo-estate");
    expect(again.email).toBe("accounts@demo-estate.example");
  });
});

describe("client page has no PayFast", () => {
  it("does not mention PayFast", () => {
    const files = [
      "src/lib/v8simple/clientPay.ts",
      "src/components/v8simple/V8SimpleClient.tsx",
    ];
    for (const file of files) expect(readFileSync(file, "utf8")).not.toMatch(/payfast/i);
  });
});
