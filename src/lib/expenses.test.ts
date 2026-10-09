import { describe, it, expect } from "vitest";
import { vatRateFor, splitInclusive, expenseTotals, receiptPath, categoryLabel } from "./expenses";

describe("expenses", () => {
  it("VAT rate by date (14% before 2018-04-01)", () => {
    expect(vatRateFor("2018-03-31")).toBe(14);
    expect(vatRateFor("2018-04-01")).toBe(15);
    expect(vatRateFor("2026-10-09")).toBe(15);
  });
  it("splits inclusive amounts like the DB", () => {
    expect(splitInclusive(1150, "2026-10-01")).toEqual({ rate: 15, vat: 150, excl: 1000, incl: 1150 });
    expect(splitInclusive(1140, "2017-06-01")).toEqual({ rate: 14, vat: 140, excl: 1000, incl: 1140 });
    expect(splitInclusive(500, "2026-10-01", false)).toEqual({ rate: 0, vat: 0, excl: 500, incl: 500 });
  });
  it("totals skip archived", () => {
    expect(expenseTotals([
      { amount_incl: 1150, vat_amount: 150, amount_excl: 1000, status: "active" },
      { amount_incl: 99, vat_amount: 9, amount_excl: 90, status: "archived" },
    ])).toEqual({ incl: 1150, vat: 150, excl: 1000, count: 1 });
  });
  it("receipt path is in the company expenses folder", () => {
    expect(receiptPath("co", "IMG 1.JPEG", "id")).toBe("co/expenses/id.jpeg");
  });
  it("labels", () => expect(categoryLabel("fuel_travel")).toBe("Fuel & travel"));
});
