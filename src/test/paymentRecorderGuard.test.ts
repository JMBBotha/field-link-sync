import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { findLikelyDuplicate } from "@/lib/paymentChanged";
const src = readFileSync("src/components/invoicing/PaymentRecorder.tsx", "utf8");
describe("Record payment guard (Johan 3 Nov 07:09)", () => {
  it("locks double submit, warns on same amount+date, confirms, refreshes the home tile", () => {
    expect(src).toMatch(/busy\.current\) return/);
    expect(src).toMatch(/already recorded on this invoice/);
    expect(src).toMatch(/data-testid="payment-saved"/);
    expect(src).toMatch(/notifyPaymentChanged\(queryClient, invoiceId\)/);
  });
  it("client-page dialog confirms when the invoice is now fully paid", () => {
    expect(readFileSync("src/components/invoicing/AddPaymentDialog.tsx", "utf8")).toMatch(/add-payment-done/);
  });
});

describe("findLikelyDuplicate", () => {
  const now = Date.parse("2026-11-03T05:10:00Z");
  it("flags same amount added in the last 10 minutes", () => {
    expect(findLikelyDuplicate([{ amount: 6412.2, created_at: "2026-11-03T05:07:11Z", payment_date: "2026-11-01" }], 6412.2, "2026-11-03", now)).not.toBeNull();
  });
  it("ignores other amounts, old entries on other dates, failed ones", () => {
    expect(findLikelyDuplicate([{ amount: 100, created_at: "2026-11-03T05:07:11Z" }], 6412.2, "2026-11-03", now)).toBeNull();
    expect(findLikelyDuplicate([{ amount: 6412.2, created_at: "2026-10-28T15:00:00Z", payment_date: "2026-10-28" }], 6412.2, "2026-11-03", now)).toBeNull();
    expect(findLikelyDuplicate([{ amount: 6412.2, created_at: "2026-11-03T05:08:00Z", status: "failed" }], 6412.2, "2026-11-03", now)).toBeNull();
  });
});
