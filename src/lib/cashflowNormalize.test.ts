import { describe, it, expect } from "vitest";
import { normalizeCf, isEmptyCf, buildWeeks } from "@/lib/cashflow";
describe("normalizeCf", () => {
  it("null / {} / bad parts never crash", () => {
    for (const raw of [null, undefined, {}, [], "x", { receivables: null, payables: 5 }]) {
      const d = normalizeCf(raw);
      expect(d.receivables).toEqual([]); expect(isEmptyCf(d)).toBe(true);
      expect(() => buildWeeks(d, new Date(), 12, 70)).not.toThrow();
    }
  });
});
