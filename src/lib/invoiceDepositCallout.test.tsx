import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { invoiceDepositCallout, storedDepositPercent } from "@/lib/invoiceDepositCallout";
import DepositDueBlock from "@/components/invoicing/DepositDueBlock";

const quoteNote = "Quote Q-100: total R 28638.43 incl VAT. 70% deposit R 20046.90 due now; balance R 8591.53 on completion.";

describe("invoice deposit callout", () => {
  const stored = {
    grandTotal: 28638.43,
    depositAmount: 20046.9,
    depositType: "percent",
    depositValue: 70,
    notes: quoteNote,
    status: "sent",
  };

  it("uses the stored deposit amount and percent, not a fresh percentage of the total", () => {
    const row = invoiceDepositCallout({ ...stored, depositAmount: 20000, depositValue: 70 });
    expect(row).toMatchObject({
      state: "due",
      depositAmount: 20000,
      depositOutstanding: 20000,
      percent: 70,
      balanceRemaining: 8638.43,
      received: 0,
    });
    expect(row!.depositAmount).not.toBe(Math.round(28638.43 * 70) / 100);
  });

  it("shows the deposit due, the percent and the balance while it is unpaid", () => {
    expect(invoiceDepositCallout(stored)).toEqual({
      state: "due",
      depositAmount: 20046.9,
      depositOutstanding: 20046.9,
      received: 0,
      percent: 70,
      balanceRemaining: 8591.53,
    });
  });

  it("shows a part-payment against the stored deposit, and leaves the balance", () => {
    const row = invoiceDepositCallout({ ...stored, amountPaid: 10000 });
    expect(row).toMatchObject({ state: "due", depositOutstanding: 10046.9, received: 10000, balanceRemaining: 8591.53 });
  });

  it("marks the deposit paid and shows the balance due once the stored deposit is covered", () => {
    const row = invoiceDepositCallout({ ...stored, amountPaid: 20046.9, status: "partially_paid" });
    expect(row).toMatchObject({ state: "paid", depositAmount: 20046.9, depositOutstanding: 0, balanceRemaining: 8591.53 });
  });

  it("lets payments past the deposit and credit notes reduce only the balance", () => {
    const row = invoiceDepositCallout({ ...stored, amountPaid: 22046.9, credited: 500 });
    expect(row).toMatchObject({ state: "paid", balanceRemaining: 6091.53 });
  });

  it("omits the percent on a fixed deposit and still shows the stored rand amount", () => {
    const row = invoiceDepositCallout({ grandTotal: 1000, depositAmount: 400, depositType: "fixed", depositValue: 400, status: "sent" });
    expect(row).toMatchObject({ state: "due", depositAmount: 400, percent: null, balanceRemaining: 600 });
  });

  it("leaves invoices with no deposit, a pay-in-full deposit, a deposit-only invoice, or a void invoice unchanged", () => {
    expect(invoiceDepositCallout({ grandTotal: 1000, status: "sent" })).toBeNull();
    expect(invoiceDepositCallout({ grandTotal: 1000, depositAmount: 0, depositType: "percent", depositValue: 0 })).toBeNull();
    expect(invoiceDepositCallout({ grandTotal: 1000, depositAmount: 1000, depositType: "percent", depositValue: 100 })).toBeNull();
    expect(invoiceDepositCallout({ grandTotal: 5000, depositAmount: 3500, depositType: "deposit_invoice", depositValue: 70 })).toBeNull();
    expect(invoiceDepositCallout({ ...stored, status: "void" })).toBeNull();
    expect(invoiceDepositCallout({ ...stored, status: "cancelled" })).toBeNull();
  });

  it("reads a stored percent from deposit_value, and only then from the system note", () => {
    expect(storedDepositPercent({ depositType: "percent", depositValue: 50, notes: quoteNote })).toBe(50);
    expect(storedDepositPercent({ depositType: "percent", depositValue: null, notes: quoteNote })).toBe(70);
    expect(storedDepositPercent({ depositType: "percent", notes: "DEPOSIT — 50%" })).toBe(50);
    expect(storedDepositPercent({ depositType: "fixed", depositValue: 400, notes: quoteNote })).toBeNull();
    expect(storedDepositPercent({ depositType: "percent", notes: "Warranty only" })).toBeNull();
  });
});

describe("Deposit due block", () => {
  const model = invoiceDepositCallout({
    grandTotal: 28638.43,
    depositAmount: 20046.9,
    depositType: "percent",
    depositValue: 70,
    status: "sent",
  })!;

  it("prints the unpaid deposit, the percent and the balance in the invoice money format", () => {
    render(<DepositDueBlock model={model} />);
    const block = screen.getByTestId("deposit-due-block");
    expect(block).toHaveAttribute("data-state", "due");
    expect(block).toHaveTextContent("DEPOSIT DUE");
    expect(screen.getByTestId("deposit-due-amount")).toHaveTextContent("R 20 046,90");
    expect(screen.getByTestId("deposit-due-detail")).toHaveTextContent("70% of the total, incl. VAT");
    expect(block).toHaveTextContent("BALANCE REMAINING");
    expect(screen.getByTestId("deposit-due-balance")).toHaveTextContent("R 8 591,53");
    expect(block.getAttribute("style") || "").toMatch(/#ffffff|rgb\(255,\s*255,\s*255\)/i);
    expect(block.innerHTML).toMatch(/#C2410C|rgb\(194,\s*65,\s*12\)/);
    expect(block.innerHTML).toMatch(/#3D9BE8|rgb\(61,\s*155,\s*232\)/);
    expect(block.innerHTML).not.toMatch(/payfast/i);
  });

  it("switches to deposit paid and the balance due", () => {
    const paid = invoiceDepositCallout({
      grandTotal: 28638.43, depositAmount: 20046.9, depositType: "percent", depositValue: 70, amountPaid: 20046.9, status: "partially_paid",
    })!;
    render(<DepositDueBlock model={paid} />);
    expect(screen.getByTestId("deposit-due-block")).toHaveAttribute("data-state", "paid");
    expect(screen.getByTestId("deposit-due-block")).toHaveTextContent("DEPOSIT PAID");
    expect(screen.getByTestId("deposit-due-amount")).toHaveTextContent("R 20 046,90");
    expect(screen.getByTestId("deposit-due-block")).toHaveTextContent("BALANCE DUE");
    expect(screen.getByTestId("deposit-due-balance")).toHaveTextContent("R 8 591,53");
  });
});
