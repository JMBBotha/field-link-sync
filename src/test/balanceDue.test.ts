import { describe, it, expect } from "vitest";
import { finalPaymentLine, onCompletionLabel, toLocalInput, fromLocalInput } from "@/lib/balanceDue";
import { dueChip } from "@/lib/invoiceDue";
import { summarizeInvoices } from "@/lib/invoiceMoney";
import { paymentReminderBodyHtml, reminderMessageCore } from "@/lib/brandedEmail";

const base = { balance: 8000, waiting: true, due: null, days: null, install_at: "2026-11-05T07:30:00Z", due_manual: false, job_done: null, status: "partially_paid" };

describe("balance due on completion", () => {
  it("waiting balance never shows due or overdue", () => {
    const l = finalPaymentLine(base);
    expect(l.label).toBe("Due on completion (installation booked 5 Nov)");
    expect(l.label).not.toMatch(/late|overdue|today/i);
  });
  it("no booking yet", () => expect(onCompletionLabel(null)).toMatch(/not booked/));
  it("after completion counts days late", () => {
    expect(finalPaymentLine({ ...base, waiting: false, due: "2026-11-05", days: 2, job_done: "2026-11-05" }).label).toBe("2 days late · due 5 Nov (job completed)");
    expect(finalPaymentLine({ ...base, waiting: false, due: "2026-11-05", days: 0, job_done: "2026-11-05" }).tone).toBe("amber");
  });
  it("manual override and paid/void", () => {
    expect(finalPaymentLine({ ...base, waiting: false, due: "2026-11-20", days: -5, due_manual: true }).label).toBe("Due 20 Nov (set by admin)");
    expect(finalPaymentLine({ ...base, balance: 0 }).label).toBe("Paid in full");
    expect(finalPaymentLine({ ...base, status: "void" }).label).toBe("Void");
  });
  it("chip on lists", () => {
    expect(dueChip({ days: 0, waiting: true, on_completion: true, install_at: "2026-11-05T07:30:00Z" }).label).toMatch(/^Due on completion \(installation booked 5 Nov\)$/);
  });
  it("client summary ignores the stale stored due date while waiting", () => {
    const inv = [{ id: "a", status: "partially_paid", grand_total: 1000, due_date: "2026-10-30" }];
    const pay = [{ invoice_id: "a", amount: 700, status: "paid" }];
    const now = new Date("2026-10-31T10:00:00+02:00");
    expect(summarizeInvoices(inv as any, pay as any, now).overdue).toBe(1);
    expect(summarizeInvoices(inv as any, pay as any, now, new Map([["a", { waiting: true, due: null }]])).overdue).toBe(0);
  });
  it("SAST datetime round trip", () => {
    expect(toLocalInput("2026-11-05T07:30:00Z")).toBe("2026-11-05T09:30");
    expect(fromLocalInput("2026-11-05T09:30")).toBe("2026-11-05T07:30:00.000Z");
  });
  it("reminder body uses the admin text without a double greeting", () => {
    expect(reminderMessageCore("Hi Test Client,\n\nBalance now due.\n\nKind regards,\nTest Co")).toBe("Balance now due.");
    const h = paymentReminderBodyHtml({ message: "Hi A,\n\nPlease pay <now>.", invoiceNumber: "INV-900", total: "R 10", paid: "R 5", balance: "R 5", dueDate: "5 November 2026" });
    expect(h).toContain("Please pay &lt;now&gt;.");
    expect(h).toContain("INV-900");
    expect(h).not.toContain("Hi A");
  });
});
