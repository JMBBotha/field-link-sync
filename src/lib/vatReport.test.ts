import { describe, it, expect } from "vitest";
import { periodOf, aggregateVat, type VatLine } from "./vatReport";

describe("VAT periods", () => {
  it("category B (Jan–Feb … Nov–Dec)", () => {
    expect(periodOf("2026-02-14", "B")).toEqual({ start: "2026-01-01", end: "2026-02-28", label: "Jan–Feb 2026" });
    expect(periodOf("2026-09-03", "B")).toEqual({ start: "2026-09-01", end: "2026-10-31", label: "Sep–Oct 2026" });
  });
  it("category A (Dec–Jan … Oct–Nov)", () => {
    expect(periodOf("2026-01-10", "A")).toEqual({ start: "2025-12-01", end: "2026-01-31", label: "Dec 2025–Jan 2026" });
    expect(periodOf("2026-12-10", "A")).toEqual({ start: "2026-12-01", end: "2027-01-31", label: "Dec 2026–Jan 2027" });
    expect(periodOf("2024-03-01", "A")).toEqual({ start: "2024-02-01", end: "2024-03-31", label: "Feb–Mar 2024" });
  });
  it("monthly", () => expect(periodOf("2024-02-10", "M")).toEqual({ start: "2024-02-01", end: "2024-02-29", label: "Feb 2024" }));
  it("output − credit notes − input; flags rate differences", () => {
    const lines: VatLine[] = [
      { kind: "invoice", date: "2026-09-03", ref: "INV-015", party: "A", incl: 7839.29, rate: 15, vat: 1022.52, stored_vat: 1022.52 },
      { kind: "credit_note", date: "2026-10-09", ref: "CN-001", party: "A", incl: -115, rate: 15, vat: -15, stored_vat: -15 },
      { kind: "expense", date: "2026-09-20", ref: null, party: "S", incl: 1150, rate: 15, vat: 150, stored_vat: 150 },
      { kind: "invoice", date: "2017-06-01", ref: "OLD", party: "B", incl: 1140, rate: 14, vat: 140, stored_vat: 148.7 },
    ];
    const [sepOct, old] = aggregateVat(lines, "B");
    expect(sepOct).toMatchObject({ label: "Sep–Oct 2026", outputVat: 1022.52, creditVat: 15, inputVat: 150, net: 857.52, docs: 3, rateDiffs: 0 });
    expect(old).toMatchObject({ label: "May–Jun 2017", outputVat: 140, net: 140, rateDiffs: 1 });
  });
});
