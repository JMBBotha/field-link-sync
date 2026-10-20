import { describe, it, expect } from "vitest";
import { dueChip, summarizeDue, type DueRow } from "./invoiceDue";
const row = (days: number, amount: number, extra: Partial<DueRow> = {}): DueRow => ({ invoice_id: String(days), invoice_number: "INV", customer_id: null, customer_name: "A", customer_email: null,
  amount_due: amount, due: "2026-10-20", days, step: days >= 14 ? "plus14" : days >= 7 ? "plus7" : days >= 3 ? "plus3" : days >= 0 ? "due" : days >= -3 ? "pre" : null, rep_id: null,
  followup_id: null, followup_status: null, followup_step: null, followup_subject: null, followup_message: null, ...extra });
describe("invoice due", () => {
  it("chips", () => {
    expect(dueChip({ days: -3 })).toEqual({ label: "Due in 3 days", tone: "blue" });
    expect(dueChip({ days: 0 }).tone).toBe("amber");
    expect(dueChip({ days: 4 })).toEqual({ label: "4 days late", tone: "orange" });
    expect(dueChip({ days: 8 }).tone).toBe("red");
  });
  it("summary buckets", () => {
    const s = summarizeDue([row(-10, 5), row(-2, 100, { followup_status: "pending" }), row(0, 50), row(8, 300), row(15, 1000)]);
    expect(s.total).toBe(1455); expect(s.soon).toEqual({ amount: 100, count: 1 }); expect(s.today.amount).toBe(50);
    expect(s.overdue).toEqual({ amount: 1300, count: 2 }); expect(s.toApprove).toBe(1); expect(s.urgent.length).toBe(1); expect(s.ownerCalls.length).toBe(1);
  });
});
