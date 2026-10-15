import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import QuoteTermsPage, { groupTermsSections } from "@/components/quoting/QuoteTermsPage";
import { buildTermsBlocks } from "@/lib/defaultTerms";
import { readFileSync } from "fs";

describe("groupTermsSections", () => {
  const sections = groupTermsSections(buildTermsBlocks({ companyName: "Massair CT (Pty) Ltd", bankName: "FNB", accountNumber: "63226563591", branchCode: "250 655", accountType: "Cheque" }));

  it("groups every heading into a numbered section, dropping title/spacers", () => {
    expect(sections.length).toBeGreaterThanOrEqual(10);
    expect(sections[0].heading).toBe("Scope of Work");
    expect(sections.every((s) => s.items.length > 0)).toBe(true);
  });

  it("keeps the banking lines inside the Banking Details section", () => {
    const bank = sections.find((s) => /banking/i.test(s.heading));
    expect(bank).toBeTruthy();
    expect(bank?.items.some((i) => i.text.includes("63226563591"))).toBe(true);
  });

  it("prints the deposit reference as its own numbered section straight after banking details", () => {
    // Johan 15 Oct 18:13: "deposit ref still needed to be a blue circle and separate from
    // banking details, just the next item — banking is 0.7 so this must be 0.8."
    const bank = sections.find((s) => /banking/i.test(s.heading));
    expect(bank?.items.some((i) => /deposit reference/i.test(i.text))).toBe(false);
    const deposit = sections.find((s) => /deposit reference/i.test(s.heading));
    expect(deposit).toBeTruthy();
    expect(deposit?.items.some((i) => /proposal number/i.test(i.text))).toBe(true);
    expect(sections.indexOf(deposit!)).toBe(sections.indexOf(bank!) + 1);
  });


  it("handles custom terms text without crashing", () => {
    const custom = groupTermsSections(buildTermsBlocks({ customText: "My terms:\n\nPay on time." }));
    expect(custom.length).toBeGreaterThan(0);
  });
});

describe("QuoteTermsPage", () => {
  it("bolds electrical and building clauses", () => {
    const html = renderToString(<QuoteTermsPage companyName="Test Company" />);
    expect(html).toMatch(/font-bold[^>]*>3\.1 Please note/);
    expect(html).toMatch(/font-bold[^>]*>4\.1 Unless stated/);
  });

  it("flows terms after unit cards without brochure pages or fixed duplicate terms", () => {
    const root = readFileSync("src/components/quoting/ClientQuotePdfRoot.tsx", "utf8");
    expect(root).not.toContain("<UnitBrochureView");
    const pdf = readFileSync("src/lib/documentPdf.ts", "utf8");
    expect(pdf).toContain("!termsEl && shouldAppendFixedTerms");
    const doc = readFileSync("src/components/documents/BrandDocument.tsx", "utf8");
    expect(doc).toContain('data-pdf-break-before={p.fullTermsPage ? undefined : ""}');
    expect(doc.indexOf("{p.fullTermsPage && p.afterTotals}")).toBeLessThan(doc.indexOf("{closing && p.fullTermsPage}"));
  });
  it("renders numbered sections and the quote number on its own page", () => {
    const html = renderToString(<QuoteTermsPage companyName="Massair CT (Pty) Ltd" accountNumber="63226563591" quoteNumber="Q-2026-0039" />);
    expect(html).not.toContain('data-pdf-hide');
    expect(html).toContain('data-pdf-terms-page');
    expect(html).not.toContain('data-html2canvas-ignore');
    expect(html).toContain('data-testid="quote-terms-page"');
    expect(html).toContain("Terms and conditions");
    expect(html).toContain("Q-2026-0039");
    expect(html).toContain(">01<");
    expect(html).toContain("Scope of Work");
    expect(html).toContain("63226563591");
  });
});
