import { describe, it, expect } from "vitest";
import { eoeClause, withEoe } from "@/lib/eoeClause";
describe("E&OE clause", () => {
  it("quote wording with company name", () => {
    expect(eoeClause("Massair CT (Pty) Ltd", "quote")).toBe("While every effort is made to ensure accuracy, this quotation is subject to errors and omissions (E&OE). Massair CT (Pty) Ltd reserves the right to correct any pricing, specification or typographical errors before acceptance or invoicing. Prices are subject to supplier availability and may change without notice until a deposit is received.");
  });
  it("invoice says this document, other company name", () => {
    const c = eoeClause("Acme Air", "invoice");
    expect(c).toContain("this document is subject"); expect(c).toContain("Acme Air reserves"); expect(c).not.toContain("Massair");
  });
  it("appends once", () => {
    const t = withEoe("Valid 30 days.", "X", "quote");
    expect(t.startsWith("Valid 30 days.")).toBe(true);
    expect(withEoe(t, "X", "quote")).toBe(t);
    expect(withEoe(null, "X", "invoice")).toContain("this document");
  });
});
