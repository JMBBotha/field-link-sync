import { describe, it, expect } from "vitest";
import { depositPercentOf } from "@/lib/depositInvoice";
import { SETTLED_PAYMENT_STATUSES } from "@/lib/payments";
import { getDepositChipState } from "@/components/shared/DepositPaymentChip";

describe("deposit trace fixes", () => {
  it("reads the % from the RPC's own note, not a hardcoded 70", () => {
    expect(depositPercentOf({ notes: "DEPOSIT — 50% of quote Q-1. Balance invoiced on completion." })).toBe(50);
  });
  it("falls back to grand_total / quote total", () => {
    expect(depositPercentOf({ notes: null, grand_total: 9774.6 }, 13963.71)).toBe(70);
    expect(depositPercentOf(null, 100)).toBeNull();
  });
  it("client settled statuses match the DB (paid, succeeded, completed)", () => {
    expect([...SETTLED_PAYMENT_STATUSES].sort()).toEqual(["completed", "paid", "succeeded"]);
  });
  it("draft deposit invoice with nothing paid shows Deposit due; part-paid shows partial", () => {
    expect(getDepositChipState({ id: "i", grand_total: 9774.6, amount_paid: 0 } as any)).toBe("due");
    expect(getDepositChipState({ id: "i", grand_total: 9774.6, amount_paid: 1000 } as any)).toBe("partial");
    expect(getDepositChipState({ id: "i", grand_total: 9774.6 } as any)).toBe("due");
  });
});
