import { describe, it, expect } from "vitest";
import { invoiceTotals, depositAmount, depositDue, profileBlockLines, profileTermsInfo, fillTermsPlaceholders } from "@/lib/companyProfiles";
import { COMPANY_BLOCK_LINES } from "@/lib/companyIdentity";
import { buildTermsBlocks } from "@/lib/defaultTerms";

const CT = { legal_name: "MASSAIR CT (PTY) Ltd", phone: "(021) 802-2889", vat_number: null, address_lines: ["9A Cabernet Rd"],
  bank_name: "FNB", account_number: "63226563591", branch_code: "250 655]", account_type: "Cheque", account_name: null, terms_text: null };
const IND = { ...CT, legal_name: "MASSAIR IND CC", vat_number: "4630313080", account_number: "62326769075", branch_code: "250 655" };

describe("invoice maths", () => {
  it("15% VAT after discount", () => {
    const t = invoiceTotals([1000, 500], { type: "percent", value: 10 });
    expect(t).toEqual({ subtotal: 1500, discountAmount: 150, taxable: 1350, vat: 202.5, total: 1552.5 });
  });
  it("deposit % is on the VAT-inclusive total", () => {
    expect(depositAmount(1150, "percent", 50)).toBe(575);
    expect(depositAmount(1150, "fixed", 2000)).toBe(1150);
    expect(depositDue(575, 200)).toBe(375);
    expect(depositDue(575, 900)).toBe(0);
  });
});

describe("company profiles", () => {
  it("no profile keeps today's fixed block", () => {
    expect(profileBlockLines(null)).toEqual(["Massair CT (Pty) Ltd", "VAT No 4630313080"]); // no hardcoded address / phone (Johan 2026-10-13)
  });
  it("CT without a VAT number prints no VAT line", () => {
    expect(profileBlockLines(CT).join("|")).not.toMatch(/VAT/);
    expect(profileBlockLines(IND)).toContain("VAT No 4630313080");
  });
  it("terms use only that company's banking (no leakage)", () => {
    const ct = JSON.stringify(buildTermsBlocks(profileTermsInfo(CT)!));
    const ind = JSON.stringify(buildTermsBlocks(profileTermsInfo(IND)!));
    expect(ct).toContain("63226563591"); expect(ct).not.toContain("62326769075");
    expect(ind).toContain("62326769075"); expect(ind).not.toContain("63226563591");
    expect(ct).toContain("250 655"); expect(ct).not.toContain("655]");
  });
  it("custom terms text fills placeholders", () => {
    const t = fillTermsPlaceholders("Pay {company} at {bank} acc {account} branch {branch}.", IND);
    expect(t).toBe("Pay MASSAIR IND CC at FNB acc 62326769075 branch 250 655.");
    const blocks = buildTermsBlocks(profileTermsInfo({ ...IND, terms_text: "Payment:\n\nPay {company}." })!);
    expect(blocks.map((b) => b.text)).toContain("Pay MASSAIR IND CC.");
  });
});
