import { describe, it, expect } from "vitest";
import { defaultRange, runningBalances, statementTotals, statementHtml, statementLinkUrl, type Statement } from "./statements";

const st: Statement = {
  customer: { name: "Andre <Blom>", company_name: null, address: "22 Rd", vat_number: null },
  company: { company_name: "Co", physical_address: "Addr", vat_number: "123", banking_details: { bank_name: "FNB", account_number: "62000000000" } },
  from: "2026-01-01", to: "2026-10-09", opening_balance: 100, closing_balance: 950,
  rows: [
    { date: "2026-09-03", type: "invoice", ref: "INV-1", description: "Deposit", debit: 1000, credit: 0, balance: 1100 },
    { date: "2026-09-10", type: "payment", ref: "INV-1", description: "Payment (eft)", debit: 0, credit: 100, balance: 1000 },
    { date: "2026-09-11", type: "credit_note", ref: "CN-001", description: "Credit", debit: 0, credit: 50, balance: 950 },
  ],
};

describe("statements", () => {
  it("default range is 12 months back", () => {
    expect(defaultRange(new Date(2026, 9, 9))).toEqual({ from: "2025-10-09", to: "2026-10-09" });
  });
  it("running balances match server rows", () => {
    expect(runningBalances(st.opening_balance, st.rows)).toEqual(st.rows.map((r) => r.balance));
  });
  it("totals by type", () => {
    expect(statementTotals(st)).toEqual({ invoiced: 1000, paid: 100, credited: 50 });
  });
  it("html escapes and shows balance due + banking", () => {
    const h = statementHtml(st);
    expect(h).toContain("Andre &lt;Blom&gt;");
    expect(h).toContain("Balance due");
    expect(h).toContain("FNB");
  });
  it("link url", () => {
    expect(statementLinkUrl("abc", "https://x.app")).toBe("https://x.app/statement/abc");
  });
});
