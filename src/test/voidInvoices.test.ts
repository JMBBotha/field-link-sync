import { describe, it, expect } from "vitest";
import { matchesInvoiceState } from "@/lib/drilldown";
import { getDepositChipState } from "@/components/shared/DepositPaymentChip";
describe("void invoices", () => {
  it("hidden by default, shown only under Void, never unpaid", () => {
    expect(matchesInvoiceState("void", null as any)).toBe(false);
    expect(matchesInvoiceState("cancelled", null as any)).toBe(false);
    expect(matchesInvoiceState("void", "void")).toBe(true);
    expect(matchesInvoiceState("void", "unpaid")).toBe(false);
    expect(matchesInvoiceState("sent", null as any)).toBe(true);
    expect(matchesInvoiceState("sent", "void")).toBe(false);
  });
  it("no deposit chip on a void invoice", () => {
    expect(getDepositChipState({ id: "x", status: "void", grand_total: 2805.13, amount_paid: 0, deposit_type: "percent" } as any)).toBeNull();
  });
});
