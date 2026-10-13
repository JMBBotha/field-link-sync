import { describe, expect, it } from "vitest";
import { itemsToRows, parseFnbStatementLines } from "./fnbPdf";

// Rows as produced by itemsToRows() from a real FNB Gold Business statement (Dec 2025).
const HEAD = [
  "Customer VAT Registration Number 4560222343  Gold Business Account : 62326769075",
  "Statement Period : 29 November 2025 to 31 December 2025",
  "Opening Balance  52,823.58 Dr  Service Fees  1,282.52 Dr  Credit Rate**  Tiered",
];
const TXNS = [
  "01 Dec FNB App Transfer To Jmb  500.00  53,323.58",
  "01 Dec FNB App Transfer To Jmb  300.00  53,623.58",
  "01 Dec Payshap Credit Tertia  5,000.00 Cr  48,623.58",
  "01 Dec FNB App Payment To Fourways Ac Helderb  Massair Ind CC  24,138.50  72,762.08",
  "01 Dec Send Money App Dr Send Almari Cloete  500.00  73,262.08  15.10",
];
const close = (v: string) => `Closing Balance  ${v}  Cash Deposit Fees  0.00  Debit Rate (Non-NCA)  21.25%`;

describe("parseFnbStatementLines", () => {
  it("reads lines, signs, reference column, account and balances", () => {
    const r = parseFnbStatementLines([...HEAD, close("73,262.08 Dr"), ...TXNS]);
    expect(r.account).toBe("FNB ..9075");
    expect(r.balanceOk).toBe(true);
    expect(r.opening).toBe(-52823.58);
    expect(r.closing).toBe(-73262.08);
    expect(r.lines).toHaveLength(5);
    expect(r.lines[0]).toEqual({ date: "2025-12-01", amount: -500, description: "FNB App Transfer To Jmb", reference: null, balance: -53323.58 });
    expect(r.lines[2].amount).toBe(5000);
    expect(r.lines[3]).toMatchObject({ description: "FNB App Payment To Fourways Ac Helderb", reference: "Massair Ind CC", amount: -24138.5 });
    expect(r.lines[4].balance).toBe(-73262.08); // accrued charges column ignored
  });

  it("handles credit balances (Cr) crossing from overdraft", () => {
    const r = parseFnbStatementLines([
      "Gold Business Account : 62326769075", "Statement Period : 31 July 2026 to 31 August 2026",
      "Opening Balance  2,000.00 Dr", "Closing Balance  86,689.85 Cr",
      "01 Aug Magtape Credit Investecpbrbk Cape Estates Paa  88,689.85 Cr  86,689.85 Cr",
    ]);
    expect(r.balanceOk).toBe(true);
    expect(r.lines[0]).toMatchObject({ date: "2026-08-01", amount: 88689.85, balance: 86689.85 });
  });

  it("puts December lines in the earlier year on a Dec-Jan statement", () => {
    const r = parseFnbStatementLines([
      "Account : 62326769075", "Statement Period : 31 December 2025 to 31 January 2026",
      "Opening Balance  100.00 Cr", "Closing Balance  50.00 Cr",
      "31 Dec Fee  25.00  75.00 Cr", "02 Jan Fee  25.00  50.00 Cr",
    ]);
    expect(r.lines.map((l) => l.date)).toEqual(["2025-12-31", "2026-01-02"]);
    expect(r.balanceOk).toBe(true);
  });

  it("blocks when a line or the closing balance doesn't add up", () => {
    const missing = parseFnbStatementLines([...HEAD, close("73,262.08 Dr"), TXNS[0], TXNS[2], TXNS[3], TXNS[4]]);
    expect(missing.balanceOk).toBe(false);
    expect(missing.balanceProblems[0]).toMatch(/expected balance/);
    const badClose = parseFnbStatementLines([...HEAD, close("1.00 Dr"), ...TXNS]);
    expect(badClose.balanceOk).toBe(false);
    expect(parseFnbStatementLines(["hello"]).balanceOk).toBe(false);
  });
});

describe("itemsToRows", () => {
  it("groups by baseline and marks column gaps with two spaces", () => {
    const rows = itemsToRows([
      { str: "500.00", x: 400, y: 700, w: 30 },
      { str: "01 Dec", x: 20, y: 700.5, w: 25 },
      { str: "FNB App Transfer", x: 60, y: 700, w: 60 },
      { str: "To Jmb", x: 122, y: 700, w: 25 },
      { str: "53,323.58", x: 470, y: 700, w: 40 },
      { str: "Next", x: 20, y: 680, w: 20 },
    ]);
    expect(rows).toEqual(["01 Dec  FNB App Transfer To Jmb  500.00  53,323.58", "Next"]);
  });
});
