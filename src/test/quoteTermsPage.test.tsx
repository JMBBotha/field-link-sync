import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import QuoteTermsPage, { groupTermsSections } from "@/components/quoting/QuoteTermsPage";
import { buildTermsBlocks } from "@/lib/defaultTerms";

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

  it("handles custom terms text without crashing", () => {
    const custom = groupTermsSections(buildTermsBlocks({ customText: "My terms:\n\nPay on time." }));
    expect(custom.length).toBeGreaterThan(0);
  });
});

describe("QuoteTermsPage", () => {
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
