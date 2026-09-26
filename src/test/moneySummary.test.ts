import { describe, it, expect } from "vitest";
import { computeMoneySummary } from "@/lib/moneySummary";
import { formatRand } from "@/utils/formatRand";

describe("computeMoneySummary", () => {
  const invoices = [
    { id: "a", status: "paid", grand_total: 10000, notes: null, quote_id: null },
    { id: "b", status: "partially_paid", grand_total: 9774.6, notes: "DEPOSIT — 70%", quote_id: "q1" },
    { id: "c", status: "draft", grand_total: 5000, notes: "DEPOSIT — 70%", quote_id: null },
    { id: "d", status: "sent", grand_total: 1200, notes: null, quote_id: null },
    { id: "e", status: "cancelled", grand_total: 999, notes: "DEPOSIT", quote_id: "q2" },
  ];
  const payments = [
    { invoice_id: "a", amount: 10000, status: "paid" },
    { invoice_id: "b", amount: 2000, status: "paid" },
    { invoice_id: "b", amount: 500, status: "pending" }, // not settled
    { invoice_id: "d", amount: 200, status: "completed" },
  ];

  it("buckets by settled balance", () => {
    const s = computeMoneySummary(invoices, payments);
    expect(s.depositsDue).toEqual({ count: 1, balance: 5000 });
    expect(s.partiallyPaid).toEqual({ count: 2, balance: 8774.6 });
    expect(s.outstanding).toEqual({ count: 3, balance: 13774.6 });
  });

  it("formats in SA style", () => {
    expect(formatRand(7774.6)).toBe("R 7 774,60");
  });
});
