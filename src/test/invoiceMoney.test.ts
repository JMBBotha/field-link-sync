import { describe, it, expect } from "vitest";
import { summarizeInvoices } from "@/lib/invoiceMoney";

describe("summarizeInvoices", () => {
  it("counts a partial deposit as paid and reduces outstanding", () => {
    const s = summarizeInvoices(
      [{ id: "a", status: "partially_paid", grand_total: 21374, due_date: "2099-01-01" } as any],
      [{ invoice_id: "a", amount: 14961.8, status: "paid" }],
    );
    expect(s.outstanding).toBe(6412.2);
    expect(s.paidValue).toBe(14961.8);
    expect(s.paidInvoices).toBe(1);
  });
  it("ignores drafts, voids and failed payments", () => {
    const s = summarizeInvoices(
      [{ id: "d", status: "draft", grand_total: 100 }, { id: "v", status: "void", grand_total: 50 }, { id: "p", status: "sent", grand_total: 200 } as any],
      [{ invoice_id: "p", amount: 200, status: "failed" }],
    );
    expect(s.outstanding).toBe(200);
    expect(s.paidValue).toBe(0);
    expect(s.draft).toBe(1);
  });
});

import { finalInvoiceStep } from "@/lib/invoiceMoney";
describe("finalInvoiceStep", () => {
  const inv = [{ id: "a", invoice_number: "INV-042", status: "partially_paid", grand_total: 21374 }];
  const pay = [{ invoice_id: "a", amount: 14961.8, status: "paid" }];
  it("shows when deposit paid and job completed", () => {
    expect(finalInvoiceStep(inv, pay, [{ status: "completed", invoice_id: "a" }])).toMatchObject({ invoiceId: "a", balance: 6412.2, kind: "send_balance" });
  });
  it("shows (final invoice ready) while job is only scheduled", () => {
    expect(finalInvoiceStep(inv, pay, [{ status: "scheduled" }])).toMatchObject({ invoiceId: "a", balance: 6412.2, jobDone: false });
  });
  it("hidden once fully paid", () => {
    expect(finalInvoiceStep(inv, [{ invoice_id: "a", amount: 21374, status: "paid" }], [{ status: "completed" }])).toBeNull();
  });
  it("hidden without a paid deposit", () => {
    expect(finalInvoiceStep(inv, [], [{ status: "completed" }])).toBeNull();
  });
  it("prefers an unsent draft balance invoice", () => {
    const s = finalInvoiceStep([...inv, { id: "b", invoice_number: "INV-050", status: "draft", grand_total: 6412.2 }], pay, [{ status: "completed" }]);
    expect(s).toMatchObject({ invoiceId: "b", kind: "send_draft" });
  });
});
