import { describe, it, expect } from "vitest";
import { parseFnbCsv, parseFnbAmount, parseFnbDate, splitCsvLine, summarize } from "./fnbCsv";

describe("FNB CSV", () => {
  it("amounts", () => {
    expect(parseFnbAmount("-1,234.56")).toBe(-1234.56);
    expect(parseFnbAmount("1 234.56")).toBe(1234.56);
    expect(parseFnbAmount("R 85.00")).toBe(85);
    expect(parseFnbAmount("1234.56Cr")).toBe(1234.56);
    expect(parseFnbAmount("123.45Dr")).toBe(-123.45);
    expect(parseFnbAmount("(12.00)")).toBe(-12);
    expect(parseFnbAmount("99,50")).toBe(99.5);
    expect(parseFnbAmount("abc")).toBeNull();
  });
  it("dates", () => {
    expect(parseFnbDate("20261001")).toBe("2026-10-01");
    expect(parseFnbDate("2026/10/01")).toBe("2026-10-01");
    expect(parseFnbDate("01/10/2026")).toBe("2026-10-01");
    expect(parseFnbDate("01 Oct 2026")).toBe("2026-10-01");
    expect(parseFnbDate("01 Mar", 2017)).toBe("2017-03-01");
    expect(parseFnbDate("31/02/2026")).toBeNull();
  });
  it("quoted CSV with commas and single quotes", () => {
    expect(splitCsvLine(`2,'62012345678',"Gold Business, Cheque",x`)).toEqual(["2", "62012345678", "Gold Business, Cheque", "x"]);
  });
  it("transaction history download (preamble + header)", () => {
    const csv = [
      "ACCOUNT TRANSACTION HISTORY",
      "Name:,MASSAIR CT (PTY) LTD",
      "Account:,62012345678",
      "Balance:,10000.00",
      "",
      "Date,Amount,Balance,Description",
      `2026/09/12,5839.29,15839.29,"FNB OB PMT ANDRE BLOM INV15"`,
      "2026/09/12,-1150.00,14689.29,ONE STOP SHOP CT",
      "2026/09/30,-85.00,14604.29,#MONTHLY ACCOUNT FEE",
      "2026/09/30,-85.00,14519.29,#MONTHLY ACCOUNT FEE",
    ].join("\r\n");
    const r = parseFnbCsv(csv);
    expect(r.format).toBe("header");
    expect(r.account).toBe("FNB ..5678");
    expect(r.lines).toHaveLength(4);
    expect(r.lines[0]).toEqual({ date: "2026-09-12", amount: 5839.29, description: "FNB OB PMT ANDRE BLOM INV15", reference: null, balance: 15839.29 });
    expect(summarize(r.lines)).toEqual({ count: 4, moneyIn: 5839.29, moneyOut: 1320, from: "2026-09-12", to: "2026-09-30" });
  });
  it("standard CSV with Effective Date + Reference + Service Fee", () => {
    const csv = ["Effective Date,Description,Reference,Service Fee,Amount,Balance", "20170315,PAYMENT FROM CLIENT,INV-007,0.00,1140.00,5000.00", "20170316,OPENING BALANCE,,,,"].join("\n");
    const r = parseFnbCsv(csv);
    expect(r.lines).toEqual([{ date: "2017-03-15", amount: 1140, description: "PAYMENT FROM CLIENT", reference: "INV-007", balance: 5000 }]);
    expect(r.skipped).toBe(1);
  });
  it("CSV Date Number (no header, DD/MM txn date, year from statement date)", () => {
    const csv = ["2,'62012345678','OPENING','1000.00'", "05/01/2026,12,FNB APP PAYMENT TO SUPPLIER,00012345,-500.00,30/12,500.00", "05/01/2026,12,MAGTAPE CREDIT CLIENT,00012346,700.00,04/01,1200.00"].join("\n");
    const r = parseFnbCsv(csv);
    expect(r.format).toBe("date-number");
    expect(r.lines.map((l) => [l.date, l.amount, l.reference])).toEqual([["2025-12-30", -500, "00012345"], ["2026-01-04", 700, "00012346"]]);
  });
});
