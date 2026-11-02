import { describe, it, expect } from "vitest";
import { parsePagesLocally, productLinesOnly, parseLinesLocally, cleanExtracted, looksPersonal } from "../../supabase/functions/_shared/supplierDocLines";

// Dummy delivery note: fictitious supplier, client and addresses.
const DN = `
Test Supplies (Pty) Ltd                                     Shipment No.        TST-DN0001
12 Example Road, Testville, 1234                            VAT Registration No.   4000000000
Phone No.   0110000000          E-Mail  sales@example.test
Bill-to Customer No.  CUS0001                               Ship-to Address
Example Aircon (Pty) Ltd                                    Jane Testperson
5 Sample Street Apt 3                                       Shipment Mobile No: +27 82 000 0000
 No.          Description                                   Location            UOM     Qty
 FCMI-24-P    IN - TEST MIDWALL INVERTER - 24000 BTU        Test Warehouse      Each    2
 FCMI-24X-P   OUT - TEST MIDWALL INVERTER - 24000 BTU       Test Warehouse      Each    2
 G005         GAS - R410 DISP 11.3KG                                             Each    1    2 260.00    2 260.00
 Customer Name: ______________   Customer Signature: ______________
 TST-DN0001   Shipment total  6
`.split("\n");

describe("POPIA product-line filter", () => {
  it("keeps only product rows; no names, addresses, phones or emails", () => {
    const keep = productLinesOnly(DN);
    expect(keep).toHaveLength(3);
    const all = keep.join("\n");
    for (const bad of ["Jane", "Testperson", "Sample Street", "+27", "example.test", "CUS0001", "Example Aircon", "Signature"]) expect(all).not.toContain(bad);
  });
  it("parses code, description, qty and price locally", () => {
    const rows = parseLinesLocally(DN);
    expect(rows[0]).toMatchObject({ model_number: "FCMI-24-P", qty: 2, unit_price_excl: null });
    expect(rows[0].description).toMatch(/TEST MIDWALL/);
    expect(rows[0].description).not.toMatch(/Warehouse/);
    expect(rows[2]).toMatchObject({ model_number: "G005", qty: 1, unit_price_excl: 2260 });
  });
  it("cleans AI output and strips personal data from descriptions", () => {
    const out = cleanExtracted({ lines: [
      { model_number: "FCMI-24-P", description: "Indoor 24K", qty: "2", unit_price_excl: "R10 434.09" },
      { model_number: "X1", description: "deliver to Jane, 0820000000", qty: 1 },
      { model_number: "", description: "", qty: 1 },
      { model_number: "BAD", qty: -3 },
    ] });
    expect(out).toHaveLength(2);
    expect(out[0].unit_price_excl).toBe(10434.09);
    expect(out[1].description).toBe("X1");
    expect(looksPersonal("jane@example.test")).toBe(true);
  });
  it("drops a repeated copy page", () => {
    expect(parsePagesLocally([DN, DN])).toHaveLength(3);
  });
});
