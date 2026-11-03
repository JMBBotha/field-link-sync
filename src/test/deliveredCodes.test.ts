import { describe, it, expect } from "vitest";
import { baseCode, deliveredSuggestions, writeDelivered, type DeliveredUnit } from "@/lib/deliveredCodes";

const u = (code: string, half: DeliveredUnit["half"], pid = "p1", serial: string | null = null): DeliveredUnit => ({ job_id: "j", product_id: pid, half, supplier_code: code, serial_no: serial, qty: 1 });

describe("deliveredCodes", () => {
  it("baseCode drops the Samsung N/X half letter", () => {
    expect(baseCode("AR40H12C1AMN")).toBe("AR40H12C1AM");
    expect(baseCode("ar40h12c1amx")).toBe("AR40H12C1AM");
  });
  it("matches by model code in the line and shows indoor / outdoor with serials", () => {
    const s = deliveredSuggestions(
      [{ description: "Installation", line_type: "installation" }, { description: "Samsung 12K inverter (AR40H12C1AM) supply only", line_type: "unit" }],
      [u("AR40H12C1AMN", "indoor", "p1", "SN1"), u("AR40H12C1AMX", "outdoor", "p1", "SN2")]);
    expect(s).toEqual([{ lineIndex: 1, text: "Delivered: Indoor AR40H12C1AMN (S/N SN1) / Outdoor AR40H12C1AMX (S/N SN2)", alreadyOnLine: false }]);
  });
  it("falls back to the only unit line when the code differs", () => {
    const s = deliveredSuggestions([{ description: "Samsung WindFree 24K", line_type: "unit" }, { description: "Labour" }],
      [u("AR24BSHCMWKN", "indoor"), u("AR24BSHCMWKX", "outdoor")]);
    expect(s[0].lineIndex).toBe(0);
    expect(s[0].text).toBe("Delivered: Indoor AR24BSHCMWKN / Outdoor AR24BSHCMWKX");
  });
  it("no guess when several sets and several unit lines don't match by code", () => {
    expect(deliveredSuggestions([{ description: "Unit A" }, { description: "Unit B" }], [u("XA1N", "indoor", "a"), u("XB1N", "indoor", "b")])).toEqual([]);
  });
  it("flags lines that already carry the codes, and writing is idempotent", () => {
    const s = deliveredSuggestions([{ description: "Indoor AR40H12C1AMN / Outdoor AR40H12C1AMX" }], [u("AR40H12C1AMN", "indoor"), u("AR40H12C1AMX", "outdoor")]);
    expect(s[0].alreadyOnLine).toBe(true);
    const once = writeDelivered("Unit", "Delivered: X"); expect(writeDelivered(once, "Delivered: X")).toBe(once);
  });
});
