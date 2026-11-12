import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { amountDueNow } from "@/lib/amountDueNow";
import { invoiceStatusAfterPayment } from "@/lib/payments";
import { PAYMENT_DUPLICATE_MESSAGE, PAYMENT_OVERPAY_MESSAGE, duplicatePaymentReference, paymentOverOutstanding } from "@/lib/paymentGuard";
import { RULES } from "@/lib/nextSteps";

const sql = (name: string) => readFileSync(`supabase/migrations/${name}`, "utf8");

describe("amount due now", () => {
  const base = { grandTotal: 28638.43, depositAmount: 20046.9, today: "2026-11-11" };
  it("shows the deposit, not the invoice total, while the balance has no date", () => {
    const due = amountDueNow({ ...base, amountPaid: 0 });
    expect(due.depositStage).toBe(true);
    expect(due.dueNow).toBe(20046.9);
    expect(due.later).toBe(8591.53);
  });
  it("shows nothing due today after the deposit is paid and the job is not done", () => {
    const due = amountDueNow({ ...base, amountPaid: 20046.9 });
    expect(due.dueNow).toBe(0);
    expect(due.later).toBe(8591.53);
  });
  it("includes the balance once the job is completed", () => {
    const due = amountDueNow({ ...base, amountPaid: 20046.9, jobDone: "2026-11-09" });
    expect(due.dueNow).toBe(8591.53);
    expect(due.later).toBe(0);
  });
  it("waits for an explicit future deposit date", () => {
    const due = amountDueNow({ ...base, amountPaid: 0, expectedDepositDate: "2026-11-20" });
    expect(due.dueNow).toBe(0);
    expect(due.later).toBe(28638.43);
  });
  it("a terms-only due date does not pull the balance forward", () => {
    const due = amountDueNow({ ...base, amountPaid: 20046.9, dueDate: "2026-11-01", dueDateManual: false });
    expect(due.dueNow).toBe(0);
  });
  it("a hand-set due date does", () => {
    const due = amountDueNow({ ...base, amountPaid: 20046.9, dueDate: "2026-11-09", dueDateManual: true });
    expect(due.dueNow).toBe(8591.53);
  });
  it("an invoice with no deposit stage shows the outstanding balance", () => {
    expect(amountDueNow({ grandTotal: 1000, amountPaid: 200, today: "2026-11-11" })).toEqual({ dueNow: 800, later: 0, depositStage: false });
  });
});

describe("a deposit cannot mark the invoice paid", () => {
  it("follows settled payments against the invoice total", () => {
    expect(invoiceStatusAfterPayment(28638.43, 20046.9, "sent")).toBe("partially_paid");
    expect(invoiceStatusAfterPayment(28638.43, 28638.43, "partially_paid")).toBe("paid");
    expect(invoiceStatusAfterPayment(100, 0, "sent")).toBe("sent");
  });
});

describe("payment recording guards", () => {
  it("rejects an amount above the outstanding balance unless the caller overrides it", () => {
    expect(paymentOverOutstanding(150, 100)).toBe(true);
    expect(paymentOverOutstanding(100, 100)).toBe(false);
    expect(PAYMENT_OVERPAY_MESSAGE).toMatch(/still outstanding/);
  });
  it("rejects the same reference twice", () => {
    const rows = [{ reference: "EFT-99", status: "paid" }];
    expect(duplicatePaymentReference(rows, " eft-99 ", (p) => p.status === "paid")).toBe(true);
    expect(duplicatePaymentReference(rows, "", (p) => p.status === "paid")).toBe(false);
    expect(PAYMENT_DUPLICATE_MESSAGE).toMatch(/already on this invoice/);
  });
});

describe("PayFast is gone from the app", () => {
  it("removes the button, the callback, the sandbox merchant and the config entry", () => {
    expect(existsSync("src/components/payments/PayfastPayButton.tsx")).toBe(false);
    expect(existsSync("supabase/functions/payfast-itn/index.ts")).toBe(false);
    const config = readFileSync("supabase/config.toml", "utf8");
    expect(config).not.toMatch(/payfast/i);
    for (const file of [
      "src/components/CustomerInvoiceView.tsx",
      "src/components/client/ClientProposalView.tsx",
      "src/hooks/useCompanySettings.ts",
    ]) {
      const text = readFileSync(file, "utf8");
      expect(text).not.toMatch(/PayFast|payfast|10000100|PAYFAST_/);
    }
    expect(readFileSync("src/components/client/ClientProposalView.tsx", "utf8")).toMatch(/ClientDepositActions/);
    expect(readFileSync("src/components/CustomerInvoiceView.tsx", "utf8")).toMatch(/Amount due now/);
    expect(readFileSync("src/components/CustomerInvoiceView.tsx", "utf8")).toMatch(/Bank details \(EFT\)/);
  });
});

describe("migration sources", () => {
  it("locks, dedupes and refuses an overpayment without writing invoice amounts", () => {
    const text = sql("20261111210000_record_invoice_payment_guard.sql");
    expect(text).toMatch(/pg_advisory_xact_lock/);
    expect(text).toMatch(/dedupe_key/);
    expect(text).toMatch(/still outstanding/);
    expect(text).toMatch(/p_allow_overpay/);
    expect(text).not.toMatch(/UPDATE public\.invoices/);
  });
  it("email amount due now uses invoice_due_now and keeps the invoice total beside it", () => {
    const text = sql("20261111211000_invoice_due_now.sql");
    expect(text).toMatch(/invoice_due_now\(NEW\.id\)/);
    expect(text).toMatch(/Amount due now \(incl\. VAT\)/);
    expect(text).toMatch(/Invoice total/);
    expect(text).toMatch(/due_now/);
    expect(text).not.toMatch(/fmt_rand_sql\(v_total\) \|\| '<\/p><\/td>/);
  });
  it("records a material shortfall and still posts the full use", () => {
    const text = sql("20261111212000_stock_shortage_alert.sql");
    expect(text).toMatch(/stock_shortages/);
    expect(text).toMatch(/stock_shortage/);
    expect(text).toMatch(/-v_qty/);
    expect(text).toMatch(/greatest\(0, qty_on_hand - v_qty\)/);
    expect(text).toMatch(/'shortfall', v_short/);
    expect(text).not.toMatch(/'unit_cost'|'sell_price'/);
  });
  it("remaps installation links inside replace_quote_from_builder", () => {
    const text = sql("20261111213000_install_link_remap.sql");
    expect(text).toMatch(/unit_item_id/);
    expect(text).toMatch(/old_id/);
    expect(readFileSync("src/utils/persistQuoteFromBaskets.ts", "utf8")).toMatch(/old_id: it\.id/);
  });
  it("will not raise a second invoice for a quote already billed in full", () => {
    const text = sql("20261111214000_no_second_full_invoice.sql");
    expect(text).toMatch(/grand_total, 0\) \+ 0\.01 >= COALESCE\(q\.total, 0\)/);
    expect(text).toMatch(/Remaining balance/);
    expect(text).toMatch(/DEPOSIT%/);
    expect(text).not.toMatch(/UPDATE public\.invoices SET/);
  });
  it("adds an in-app accepted-no-job reminder and does not send email", () => {
    const text = sql("20261111215000_accepted_unbooked_reminder.sql");
    expect(text).toMatch(/accepted, no job booked/);
    expect(text).toMatch(/fl_weekday_hours/);
    expect(text).toMatch(/fl_alert_deliver/);
    expect(text).toMatch(/IND-/);
    expect(text).not.toMatch(/http_post|send-transactional/);
    expect(RULES.accepted_unbooked.action).toBe("Book the job");
  });
});
