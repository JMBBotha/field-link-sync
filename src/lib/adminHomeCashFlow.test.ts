import { describe, expect, it } from "vitest";
import {
  MASSAIR_CT_ID, MASSAIR_IND_ID, TEST_HVAC_ID,
  assessInvoiceUnits, countCashFlow, isUnitLine, supplierCostIncl,
  type CashInvoice, type CashLineInput,
} from "@/lib/adminHomeCashFlow";

const CT = MASSAIR_CT_ID;
const inv = (over: Partial<CashInvoice> & { id: string }): CashInvoice => ({
  company_id: CT, status: "sent", grand_total: 15000, invoice_number: "INV-1", customer_name: "Ndlovu",
  expected_final_date: "2026-12-15", sent_at: "2026-11-01", ...over,
});

const unitLine = (over: Partial<CashLineInput> = {}): CashLineInput => ({
  id: "line-1", name: "Samsung AR12 wall mount split 12000 BTU", quantity: 1,
  product_code: "AR12", product_category: "Air Conditioning", line_type: "equipment", ...over,
});

describe("cash-flow glance counting", () => {
  it("keeps a deposit job's money in, supplier liability and the final still to come", () => {
    const glance = countCashFlow({
      companyId: CT,
      invoices: [inv({ id: "i1", grand_total: 15000, call_out_excl_vat: 500 })],
      payments: [{ invoice_id: "i1", amount: 8000, status: "paid" }, { invoice_id: "i1", amount: 100, status: "pending" }],
      linesByInvoice: { i1: [unitLine({ quantity: 1, product_id: "p1" }), { id: "co", name: "Call-out fee", quantity: 1, line_type: "service" }] },
      products: [{ id: "p1", cost_excl_vat: 10000, vat_rate: 15, product_code: "AR12", product_category: "Air Conditioning" }],
    });
    expect(glance.moneyIn).toBe(8000);
    expect(glance.liability).toBe(11500);
    expect(glance.expectedFinals).toBe(7000);
    expect(glance.netCover).toBe(8000 + 7000 - 11500);
    expect(glance.uncostedUnits).toBe(0);
    expect(glance.when.map((g) => g.label)).toEqual(["15 Dec 2026"]);
  });

  it("uses catalogue cost including VAT when that figure is filled in", () => {
    expect(supplierCostIncl({ cost_incl_vat: 1150, cost_excl_vat: 900 })?.cost).toBe(1150);
    const [row] = assessInvoiceUnits({
      invoiceId: "i",
      lines: [unitLine({ quantity: 2, product_id: "p" })],
      products: [{ id: "p", cost_incl_vat: 1150, product_category: "Air Conditioning", product_code: "AR12" }],
    });
    expect(row.liability).toBe(2300);
    expect(row.costSource).toBe("catalogue_incl");
  });

  it("does not guess a price, and does not count ordered, stock or installed units", () => {
    const bare = assessInvoiceUnits({
      invoiceId: "i",
      lines: [unitLine({ product_id: "missing" })],
      commitments: [{ id: "c", invoice_id: "i", kind: "unit", item: "AR12 wall mount", status: "needed", unit_cost_excl: 4000, qty: 1 }],
    });
    expect(bare[0].uncosted).toBe(true);
    expect(bare[0].liability).toBe(0);

    const ordered = assessInvoiceUnits({
      invoiceId: "i",
      lines: [unitLine({ product_id: "p" })],
      products: [{ id: "p", cost_incl_vat: 1150, product_category: "Air Conditioning", product_code: "AR12" }],
      commitments: [{ id: "c", invoice_id: "i", kind: "unit", item: "AR12", status: "ordered_paid", qty: 1 }],
    });
    expect(ordered[0].liability).toBe(0);
    expect(ordered[0].status).toBe("ordered_paid");

    const covered = assessInvoiceUnits({
      invoiceId: "i",
      lines: [unitLine({ quantity: 2, product_id: "p" })],
      products: [{ id: "p", cost_excl_vat: 1000, product_category: "Air Conditioning", product_code: "AR12" }],
      commitments: [{ id: "c", invoice_id: "i", kind: "unit", item: "AR12", status: "needed", qty: 2 }],
      allocations: [{ commitment_id: "c", qty: 2 }],
    });
    expect(covered[0].status).toBe("in_stock");
    expect(covered[0].liability).toBe(0);
  });

  it("uses a purchase-order cost only when the catalogue has none, and only while the unit is still needed", () => {
    const [row] = assessInvoiceUnits({
      invoiceId: "i",
      lines: [unitLine()],
      poLines: [{ id: "po", invoice_id: "i", status: "draft", model_code: "AR12", unit_cost_excl_vat: 8000, description: "AR12" }],
    });
    expect(row.costSource).toBe("purchase_order");
    expect(row.liability).toBe(9200);
    const [paid] = assessInvoiceUnits({
      invoiceId: "i",
      lines: [unitLine()],
      poLines: [{ id: "po", invoice_id: "i", status: "ordered", model_code: "AR12", unit_cost_excl_vat: 8000, description: "AR12" }],
    });
    expect(paid.liability).toBe(0);
    expect(paid.status).toBe("ordered_paid");
  });

  it("does not treat a call-out as a unit and never deducts it from customer figures", () => {
    expect(isUnitLine({ id: "c", name: "Call-out fee", line_type: "service" })).toBe(false);
    expect(isUnitLine({ id: "l", name: "Installation labour" })).toBe(false);
    expect(isUnitLine({ id: "p", name: "Copper 1/4", product_category: "Consumables" })).toBe(false);
    const glance = countCashFlow({
      companyId: CT,
      invoices: [inv({ id: "i1", grand_total: 15000, call_out_excl_vat: 850 })],
      payments: [{ invoice_id: "i1", amount: 8000, status: "paid" }],
      credits: [{ invoice_id: "i1", total: 200, status: "issued" }],
      linesByInvoice: { i1: [{ id: "co", name: "Call-out fee", quantity: 1, line_type: "labour" }] },
    });
    expect(glance.moneyIn).toBe(8000);
    expect(glance.expectedFinals).toBe(6800);
    expect(glance.liability).toBe(0);
    expect(glance.liabilityLines).toHaveLength(0);
  });

  it("reads units from the quote when the invoice only has a deposit line", () => {
    const glance = countCashFlow({
      companyId: CT,
      invoices: [inv({ id: "i1", quote_id: "q1", grand_total: 10000, expected_final_date: null })],
      payments: [{ invoice_id: "i1", amount: 5000, status: "completed" }],
      linesByInvoice: { i1: [{ id: "dep", name: "Deposit 50%", quantity: 1, line_type: "service" }] },
      quoteLinesByQuote: { q1: [unitLine({ product_id: "p1" })] },
      products: [{ id: "p1", cost_incl_vat: 4000, product_category: "Air Conditioning", product_code: "AR12" }],
    });
    expect(glance.liability).toBe(4000);
    expect(glance.liabilityLines[0].label).toContain("from the quote");
    expect(glance.when[0].label).toBe("Date not set");
    expect(glance.finalLines[0].href).toContain("#expected-final");
  });

  it("isolates the signed-in company and leaves drafts, voids and unpaid invoices out", () => {
    const glance = countCashFlow({
      companyId: CT,
      invoices: [
        inv({ id: "ct", invoice_number: "INV-CT" }),
        inv({ id: "ind", company_id: MASSAIR_IND_ID, invoice_number: "INV-IND" }),
        inv({ id: "test", company_id: TEST_HVAC_ID, invoice_number: "INV-TEST" }),
        inv({ id: "draft", status: "draft", sent_at: null, invoice_number: "INV-D" }),
        inv({ id: "void", status: "void", invoice_number: "INV-V" }),
        inv({ id: "none", invoice_number: "INV-0" }),
      ],
      payments: [
        { invoice_id: "ct", company_id: CT, amount: 1000, status: "paid" },
        { invoice_id: "ind", company_id: MASSAIR_IND_ID, amount: 9000, status: "paid" },
        { invoice_id: "test", company_id: TEST_HVAC_ID, amount: 9000, status: "paid" },
        { invoice_id: "draft", amount: 9000, status: "paid" },
        { invoice_id: "void", amount: 9000, status: "paid" },
      ],
    });
    expect(glance.moneyIn).toBe(1000);
    expect(glance.moneyLines.map((l) => l.label)).toEqual(["INV-CT · Ndlovu"]);
    expect(countCashFlow({ companyId: TEST_HVAC_ID, invoices: [inv({ id: "t", company_id: TEST_HVAC_ID })], payments: [{ invoice_id: "t", amount: 5, status: "paid" }] }).moneyIn).toBe(0);
    expect(countCashFlow({ companyId: MASSAIR_IND_ID, invoices: [inv({ id: "ct" }), inv({ id: "ind", company_id: MASSAIR_IND_ID, invoice_number: "INV-IND" })], payments: [{ invoice_id: "ind", amount: 40, status: "paid" }, { invoice_id: "ct", amount: 90, status: "paid" }] }).moneyIn).toBe(40);
  });

  it("groups expected finals by date and keeps a missing date visible", () => {
    const glance = countCashFlow({
      companyId: CT,
      invoices: [
        inv({ id: "a", invoice_number: "INV-A", expected_final_date: "2026-12-04", grand_total: 3000 }),
        inv({ id: "b", invoice_number: "INV-B", expected_final_date: "2026-11-20", grand_total: 4000 }),
        inv({ id: "c", invoice_number: "INV-C", expected_final_date: null, grand_total: 5000 }),
        inv({ id: "d", invoice_number: "INV-D", expected_final_date: null, grand_total: 2000 }),
      ],
      payments: [
        { invoice_id: "a", amount: 1000, status: "paid" },
        { invoice_id: "b", amount: 1000, status: "succeeded" },
        { invoice_id: "c", amount: 1000, status: "paid" },
        { invoice_id: "d", amount: 2000, status: "paid" },
      ],
    });
    expect(glance.when.map((g) => g.key)).toEqual(["2026-11-20", "2026-12-04", "unset"]);
    expect(glance.when.find((g) => g.key === "unset")?.lines.map((l) => l.label)).toEqual(["INV-C · Ndlovu"]);
    expect(glance.expectedFinals).toBe(2000 + 3000 + 4000);
  });
});
