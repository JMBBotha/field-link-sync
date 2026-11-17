import { describe, it, expect } from "vitest";
import { V8_DEMO_DEPOSIT_PERCENT, V8_QUOTE_OPTIONS, v8ApplyDiscount, v8PackList, v8QuoteTotals } from "@/lib/v8simple/quote";

describe("V8 quote", () => {
  it("blocks a second discount and a discount over 15%", () => {
    expect(v8ApplyDiscount(null, 10)).toEqual({ ok: true, percent: 10 });
    expect(v8ApplyDiscount(10, 5).ok).toBe(false);
    expect(v8ApplyDiscount(null, 16).ok).toBe(false);
    expect(v8ApplyDiscount(null, 15)).toEqual({ ok: true, percent: 15 });
  });

  it("sets the deposit from the company percent", () => {
    const lines = V8_QUOTE_OPTIONS[0].lines;
    const plain = v8QuoteTotals(lines, 0, V8_DEMO_DEPOSIT_PERCENT);
    expect(plain.deposit).toBe(Math.round(plain.total * 70) / 100);
    const cut = v8QuoteTotals(lines, 10, 70);
    expect(cut.total).toBe(Math.round((cut.subtotal - cut.discount) * 100) / 100);
    expect(cut.deposit).toBe(Math.round(cut.total * 70) / 100);
  });

  it("lists every unit and material on the pack list", () => {
    for (const option of V8_QUOTE_OPTIONS) {
      const pack = v8PackList(option.lines);
      const expected = option.lines.filter((line) => line.kind === "unit" || line.kind === "material");
      expect(pack.map((line) => line.name)).toEqual(expected.map((line) => line.name));
      expect(pack.some((line) => line.kind === "labour")).toBe(false);
    }
  });
});
