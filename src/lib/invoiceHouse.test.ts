import { describe, it, expect } from "vitest";
import { invoiceHouseNo, invoiceHouseLabel, invoiceMatchesSearch, linkedInvoiceHouseLabel } from "./invoiceHouse";

describe("invoice house label", () => {
  it("prefers the linked project house", () => {
    const inv = { project_house: { house_no: "12", project: { name: "Estate A" } }, line_items: [{ description: "HOUSE 99 - X" }] };
    expect(invoiceHouseNo(inv)).toBe("12");
    expect(invoiceHouseLabel(inv, true)).toBe("House 12 · Estate A");
  });
  it("falls back to a HOUSE tag in line 1 or the notes", () => {
    expect(invoiceHouseNo({ line_items: [{ description: "HOUSE 7 - ESTATE\nSupply units" }] })).toBe("7");
    expect(invoiceHouseNo({ notes: "House no. 31b - estate\nPO 1" })).toBe("31B");
    expect(invoiceHouseLabel({ notes: "Service at shop" })).toBeNull();
  });
  it("expected money in uses the linked house only", () => {
    expect(linkedInvoiceHouseLabel({ project_house: { house_no: "86" }, notes: "HOUSE 99 - AVEC" })).toBe("House 86");
    expect(linkedInvoiceHouseLabel({ project_house: { house_no: " 18 " }, line_items: [{ description: "HOUSE 1 - X" }] })).toBe("House 18");
    expect(linkedInvoiceHouseLabel({ notes: "HOUSE 99 - AVEC", project_house: null })).toBeNull();
    expect(linkedInvoiceHouseLabel({ notes: "HOUSE 18 - AVEC" })).toBeNull();
    expect(linkedInvoiceHouseLabel({ project_house: { house_no: "   " } })).toBeNull();
    expect(linkedInvoiceHouseLabel(null)).toBeNull();
  });
  it("does not read a later notes line or warehouse words", () => {
    expect(invoiceHouseNo({ notes: "Thanks\nHOUSE 5" })).toBeNull();
    expect(invoiceHouseNo({ line_items: [{ description: "Warehouse 5 pickup" }] })).toBeNull();
  });
  it("search matches house exactly, plus name and number", () => {
    const inv = { customer_name: "Client Co", invoice_number: "0010001", project_house: { house_no: "86" } };
    expect(invoiceMatchesSearch(inv, "86")).toBe(true);
    expect(invoiceMatchesSearch(inv, "house 86")).toBe(true);
    expect(invoiceMatchesSearch(inv, "h86")).toBe(true);
    expect(invoiceMatchesSearch(inv, "8")).toBe(false);
    expect(invoiceMatchesSearch(inv, "client")).toBe(true);
    expect(invoiceMatchesSearch(inv, "0010001")).toBe(true);
  });
});
