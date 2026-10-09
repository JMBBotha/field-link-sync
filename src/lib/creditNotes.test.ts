import { describe, expect, it } from "vitest";
import { creditedByInvoice, suggestReason, vatFromInclusive } from "./creditNotes";
import { invoiceMoney } from "./moneySummary";

describe("credit notes", () => {
  it("VAT inside an inclusive amount", () => {
    expect(vatFromInclusive(115, 15)).toBe(15);
    expect(vatFromInclusive(50, 15)).toBe(6.52);
    expect(vatFromInclusive(114, 14)).toBe(14);
    expect(vatFromInclusive(100, 0)).toBe(0);
  });
  it("only issued credit notes count", () => {
    const m = creditedByInvoice([{ invoice_id: "a", total: 50 }, { invoice_id: "a", total: "100", status: "issued" }, { invoice_id: "a", total: 30, status: "void" }]);
    expect(m.get("a")).toBe(150);
  });
  it("balance = total - paid - credited", () => {
    const inv = { id: "a", status: "partially_paid", grand_total: 1150 };
    expect(invoiceMoney(inv, [{ invoice_id: "a", amount: 1000, status: "paid" }], [{ invoice_id: "a", total: 50 }])).toEqual({ paid: 1000, credited: 50, balance: 100 });
    expect(invoiceMoney(inv, [{ invoice_id: "a", amount: 1000, status: "paid" }]).balance).toBe(150);
  });
  it("suggests rounding for tiny balances", () => {
    expect(suggestReason(0.4)).toBe("rounding");
    expect(suggestReason(250)).toBe("write_off");
  });
});
