import { describe, it, expect } from "vitest";
import { stripLegacyBanking } from "@/components/quoting/EstimateDocument";
import { profileBlockLines, profileContactLine, profileIdentity } from "@/lib/companyProfiles";
import { COMPANY_BLOCK_LINES } from "@/lib/companyIdentity";

const TERMS = `Scope of Work:
1.1 We, Massair CT Pty Limited, agree.

Warranty:
5.2 Installed by Massair CT Pty Limited.

Banking Details:
6.1 Account Name: Massair CT Pty Limited
6.2 Bank: FNB
6.3 Account Type: Cheque Account
6.4 Account Number: 63226563591
6.5 Branch Code: [250 655]

Deposit Reference:
7.1 Please use the Proposal number.

Confidentiality:
8.1 Private.

Termination:
9.1 Notice.

Dispute Resolution:
10.1 Good faith.

Importance of Servicing AC Units

Health and Safety Concerns:
a. Health.`;

describe("stripLegacyBanking keeps every clause", () => {
  const out = stripLegacyBanking(TERMS)!;
  it("keeps clauses 1-10 and Importance of Servicing", () => {
    for (const t of ["1.1", "5.2", "Deposit Reference:", "7.1", "8.1", "9.1", "10.1", "Importance of Servicing AC Units", "a. Health."]) expect(out).toContain(t);
  });
  it("drops only the typed account lines (banking block shows the record)", () => {
    expect(out).not.toContain("63226563591");
    expect(out).not.toContain("6.2 Bank");
    expect(out).toContain("Banking Details:\n6.1 See the Banking Details below.");
  });
  it("terms without banking are untouched", () => {
    expect(stripLegacyBanking("1.1 A\n\n2.1 B")).toBe("1.1 A\n\n2.1 B");
    expect(stripLegacyBanking(null)).toBeNull();
  });
});

const CT_ID = "361bf031-9cdb-4d7f-9bde-9eb95fa4725e";
const CT = { company_id: CT_ID, legal_name: "MASSAIR CT PTY LTD", phone: "(021) 802 2889", vat_number: "4630313080",
  address_lines: ["9A Cabernet Rd", "Blackheath", "Cape Town", "7580"], email: "info@0800becool.co.za", website: null, whatsapp: null };
const OTHER = { company_id: "aaaaaaaa-0000-0000-0000-000000000000", legal_name: "OTHER CO", phone: null, vat_number: null,
  address_lines: ["1 Main Rd"], email: "a@b.co", website: null, whatsapp: null };

describe("header from the company record", () => {
  it("CT header shows record values, fixed values only fill empty fields", () => {
    expect(profileBlockLines(CT)).toEqual(["MASSAIR CT PTY LTD", "(021) 802 2889", "VAT No 4630313080", "9A Cabernet Rd", "Blackheath", "Cape Town", "7580"]);
    expect(profileContactLine(CT)).toBe("WhatsApp/Cell 069 683 8624 · info@0800becool.co.za · www.0800becool.co.za");
  });
  it("another company never gets CT's fixed values", () => {
    const lines = profileBlockLines(OTHER).join("|") + profileContactLine(OTHER);
    expect(lines).not.toMatch(/802|4630313080|0800becool\.co\.za|069 683|Cabernet/);
    expect(profileIdentity(OTHER).legalName).toBe("OTHER CO");
  });
  it("no record = fixed fallback block", () => {
    expect(profileBlockLines(null)).toEqual(["Massair CT (Pty) Ltd", "VAT No 4630313080"]); // no hardcoded address / phone (Johan 2026-10-13)
  });
});
