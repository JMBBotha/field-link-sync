import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import InvoiceDocument from "@/components/invoicing/InvoiceDocument";

vi.mock("@/hooks/useCompanySettings", () => ({
  useCompanySettings: () => ({ settings: { banking_details: {}, default_payment_terms_days: 7 }, isLoading: false }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}) } }));

const profile = {
  legal_name: "MASSAIR CT (PTY) LTD",
  vat_number: "4630313080",
  phone: "(021) 802-2889",
  email: "info@0800becool.co.za",
  bank_name: "FNB",
  account_name: "MASSAIR CT (PTY) LTD",
  account_number: "63226563591",
  branch_code: "250655",
  account_type: "Cheque",
} as const;

const lines = [{ description: "Lounge split", quantity: 1, unit_price: 24902.98, amount: 24902.98 }];

function renderInvoice(extra: Record<string, unknown> = {}) {
  return render(
    <InvoiceDocument
      invoiceNumber="INV-100"
      status="sent"
      issueDate="2026-11-11"
      customerName="AVEC La Terre"
      items={lines}
      subtotal={24902.98}
      taxRate={15}
      taxAmount={3735.45}
      grandTotal={28638.43}
      profile={profile}
      termsCompany={{ companyName: "MASSAIR CT (PTY) LTD", bankName: "FNB", accountNumber: "63226563591" }}
      {...extra}
    />,
  );
}

describe("invoice document deposit block", () => {
  it("puts the deposit due block under the header, inside the PDF capture, and not down in the terms", () => {
    renderInvoice({ depositAmount: 20046.9, depositType: "percent", depositValue: 70, notes: "70% deposit R 20046.90 due now" });
    const root = document.querySelector('[data-pdf-capture-root="invoice"]') as HTMLElement;
    const block = screen.getByTestId("deposit-due-block");
    const linesEl = screen.getByTestId("doc-lines");
    const terms = screen.getByTestId("quote-terms-page");
    expect(root.contains(block)).toBe(true);
    expect(root.innerHTML.indexOf('data-testid="deposit-due-block"')).toBeLessThan(root.innerHTML.indexOf('data-testid="doc-lines"'));
    expect(block.compareDocumentPosition(linesEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(block.compareDocumentPosition(terms) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(block).toHaveTextContent("R 20 046,90");
    expect(screen.queryByTestId("deposit-box")).toBeNull();
    expect(screen.getByText("Amount due (ZAR)").closest("tr")?.textContent).toContain("R 28 638,43");
  });

  it("shows a paid deposit and the balance still due, without changing the invoice total", () => {
    renderInvoice({ depositAmount: 20046.9, depositType: "percent", depositValue: 70, amountPaid: 20046.9, status: "partially_paid" });
    expect(screen.getByTestId("deposit-due-block")).toHaveAttribute("data-state", "paid");
    expect(screen.getByTestId("deposit-due-balance")).toHaveTextContent("R 8 591,53");
    expect(screen.getByText("Amount due (ZAR)").closest("tr")?.textContent).toContain("R 8 591,53");
  });

  it("renders no deposit block when the invoice does not ask for one", () => {
    renderInvoice();
    expect(screen.queryByTestId("deposit-due-block")).toBeNull();
    expect(screen.getByText("Amount due (ZAR)").closest("tr")?.textContent).toContain("R 28 638,43");
  });

  it("is wired into the staff invoice, the public invoice and the draft preview", () => {
    const detail = readFileSync("src/components/invoicing/InvoiceDetailPage.tsx", "utf8");
    const pub = readFileSync("src/components/CustomerInvoiceView.tsx", "utf8");
    const draft = readFileSync("src/components/invoicing/CreateInvoicePage.tsx", "utf8");
    expect(detail).toContain("depositAmount={invoice.deposit_amount}");
    expect(detail).toContain("depositValue={invoice.deposit_value}");
    expect(pub).toContain("invoiceDepositCallout");
    expect(pub).toContain("<DepositDueBlock");
    expect(pub).not.toMatch(/PayFast|payfast/);
    expect(draft).toContain("<DepositDueBlock");
    const doc = readFileSync("src/components/documents/BrandDocument.tsx", "utf8");
    expect(doc.indexOf("{p.banner}")).toBeLessThan(doc.indexOf('className="parties"'));
    expect(doc.indexOf("{p.banner}")).toBeGreaterThan(doc.indexOf("{p.stampsRow}"));
  });
});
