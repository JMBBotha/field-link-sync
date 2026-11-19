import { describe, expect, it } from "vitest";
import {
  MASSAIR_CT_ID,
  countAdminHome,
  expectedFinalPaymentDate,
  expectedFinalPaymentLabel,
  sortCountLines,
  type HomeInvoice,
  type HomePayment,
} from "@/lib/adminHomeCount";
import { groupExpectedHouses } from "@/lib/expectedMoneyHouses";
import { paymentWhen } from "@/lib/yardView";
import { formatRand } from "@/utils/formatRand";

const CT = MASSAIR_CT_ID;
const TOTAL = 61461.99;
const DEPOSIT = 43023.39;

function inv(over: Partial<HomeInvoice> & { id: string }): HomeInvoice {
  return {
    company_id: CT,
    status: "sent",
    sent_at: "2026-11-16T08:00:00+02:00",
    issue_date: "2026-11-16",
    grand_total: TOTAL,
    customer_name: "Mark Le Grange",
    invoice_number: "INV-045",
    notes: "70% deposit due now. Balance on completion.",
    ...over,
  };
}

function pay(amount: number, invoiceId = "inv-045"): HomePayment {
  return { id: "p", invoice_id: invoiceId, company_id: CT, amount, status: "paid", payment_date: "2026-11-17" };
}

describe("deposit due classification", () => {
  it("puts an unpaid deposit amount in Deposits due, not Finals due", () => {
    const c = countAdminHome({
      companyId: CT,
      invoices: [inv({ id: "inv-045", deposit_amount: DEPOSIT, deposit_type: "percent" })],
    });
    expect(c.deposit.lines.map((line) => line.id)).toEqual(["inv-045"]);
    expect(c.deposit.total).toBe(DEPOSIT);
    expect(c.finalDue.lines).toHaveLength(0);
    expect(c.deposit.lines[0].finalLabel).toContain("invoice date");
    expect(c.deposit.lines[0].finalLabel).toContain("16 Nov");
    expect(c.owed.total).toBe(TOTAL);
  });

  it("moves the invoice to Finals due for the remaining balance once the deposit is paid", () => {
    const c = countAdminHome({
      companyId: CT,
      invoices: [inv({ id: "inv-045", deposit_amount: DEPOSIT, deposit_type: "percent" })],
      payments: [pay(DEPOSIT)],
    });
    expect(c.deposit.lines).toHaveLength(0);
    expect(c.finalDue.lines.map((line) => line.id)).toEqual(["inv-045"]);
    expect(c.finalDue.total).toBe(Math.round((TOTAL - DEPOSIT) * 100) / 100);
    expect(c.finalDue.lines[0].finalDate).toBe("2026-11-16");
  });

  it("keeps a note that starts with DEPOSIT in Deposits due when no deposit amount is stored", () => {
    const c = countAdminHome({
      companyId: CT,
      invoices: [inv({ id: "note", grand_total: 8000, notes: "DEPOSIT — 50%", deposit_amount: null, deposit_type: null, invoice_number: "INV-DEP" })],
    });
    expect(c.deposit.total).toBe(8000);
    expect(c.finalDue.lines).toHaveLength(0);
  });

  it("treats a deposit type with no amount as Deposits due", () => {
    const c = countAdminHome({
      companyId: CT,
      invoices: [inv({ id: "typed", grand_total: 2000, notes: "Balance", deposit_type: "fixed", deposit_amount: 0, invoice_number: "INV-TYPE" })],
    });
    expect(c.deposit.total).toBe(2000);
    expect(c.finalDue.lines).toHaveLength(0);
  });

  it("puts an invoice with no deposit in Finals due", () => {
    const c = countAdminHome({
      companyId: CT,
      invoices: [inv({ id: "full", grand_total: 5000, notes: "Balance", deposit_amount: null, deposit_type: null, invoice_number: "INV-FIN" })],
    });
    expect(c.deposit.lines).toHaveLength(0);
    expect(c.finalDue.total).toBe(5000);
  });

  it("leaves an unsent draft out of both lists", () => {
    const c = countAdminHome({
      companyId: CT,
      invoices: [inv({ id: "draft", status: "draft", sent_at: null, deposit_amount: DEPOSIT, deposit_type: "percent" })],
    });
    expect(c.waiting.count).toBe(1);
    expect(c.deposit.lines).toHaveLength(0);
    expect(c.finalDue.lines).toHaveLength(0);
  });

  it("uses the invoice date until a final payment date is saved, and that date sorts the rows", () => {
    expect(expectedFinalPaymentDate({ issue_date: "2026-11-16" })).toBe("2026-11-16");
    expect(expectedFinalPaymentDate({ issue_date: "2026-11-16", expected_final_payment_date: null })).toBe("2026-11-16");
    expect(expectedFinalPaymentDate({ issue_date: "2026-11-16", expected_final_payment_date: "2026-12-20" })).toBe("2026-12-20");
    expect(expectedFinalPaymentLabel({ issue_date: "2026-11-16" })).toMatch(/16 Nov/);
    expect(expectedFinalPaymentLabel({ issue_date: "2026-11-16" })).toMatch(/invoice date/);
    expect(expectedFinalPaymentLabel({ issue_date: "2026-11-16", expected_final_payment_date: "2026-12-20" })).toMatch(/20 Dec/);
    expect(expectedFinalPaymentLabel({ issue_date: "2026-11-16", expected_final_payment_date: "2026-12-20" })).not.toMatch(/invoice date/);

    const c = countAdminHome({
      companyId: CT,
      invoices: [
        inv({ id: "later", invoice_number: "INV-L", grand_total: 9000, notes: "Balance", issue_date: "2026-11-01", expected_final_payment_date: "2026-12-20" }),
        inv({ id: "sooner", invoice_number: "INV-S", grand_total: 1000, notes: "Balance", issue_date: "2026-11-02", expected_final_payment_date: "2026-11-18" }),
      ],
    });
    expect(c.finalDue.lines.map((line) => line.id)).toEqual(["later", "sooner"]);
    expect(sortCountLines(c.finalDue.lines, "amount").map((line) => line.id)).toEqual(["later", "sooner"]);
    expect(sortCountLines(c.finalDue.lines, "final").map((line) => line.id)).toEqual(["sooner", "later"]);
  });

  it("does not invent a yard date from the issue date, and a saved final date wins", () => {
    expect(paymentWhen(inv({ id: "plain", notes: "Balance", issue_date: "2026-11-16" }), "final")).toEqual({ iso: null, tone: "none" });
    expect(paymentWhen(inv({ id: "set", notes: "Balance", issue_date: "2026-11-16", expected_final_date: "2026-11-28", expected_final_payment_date: "2026-12-20" }), "final"))
      .toEqual({ iso: "2026-12-20", tone: "expected" });
  });

  it("lists the same invoice on the house row for Deposits due, then Finals due", () => {
    const open = inv({ id: "inv-045", deposit_amount: DEPOSIT, deposit_type: "percent" });
    const deposits = groupExpectedHouses({ companyId: CT, today: "2026-11-18", invoices: [open] });
    const depositRow = deposits.groups[0].rows[0].deposit[0];
    expect(depositRow.invoiceNumber).toBe("INV-045");
    expect(depositRow.amountLabel).toBe(formatRand(DEPOSIT));
    expect(depositRow.inFigure).toBe(true);
    expect(depositRow.finalPayLabel).toMatch(/16 Nov/);
    expect(depositRow.finalPayDate).toBe("2026-11-16");
    const later = deposits.groups[0].rows[0].final[0];
    expect(later.inFigure).toBe(false);
    expect(later.chip).toBe("After the deposit");
    expect(later.amountLabel).toBe(formatRand(Math.round((TOTAL - DEPOSIT) * 100) / 100));
    expect(deposits.groups[0].rows[0].inFinals).toBe(false);

    const paid = groupExpectedHouses({
      companyId: CT,
      today: "2026-11-18",
      invoices: [open],
      payments: [pay(DEPOSIT)],
    });
    const finalRow = paid.groups[0].rows[0].final[0];
    expect(paid.groups[0].rows[0].deposit.filter((entry) => entry.inFigure)).toHaveLength(0);
    expect(finalRow.invoiceNumber).toBe("INV-045");
    expect(finalRow.inFigure).toBe(true);
    expect(finalRow.amountLabel).toBe(formatRand(Math.round((TOTAL - DEPOSIT) * 100) / 100));
    expect(finalRow.finalPayDate).toBe("2026-11-16");
  });
});
