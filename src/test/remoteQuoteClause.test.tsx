import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { buildTermsBlocks, PAYMENT_21 } from "@/lib/defaultTerms";
import { withRemoteNotice, usesLegacyPaymentTerms, REMOTE_QUOTE_NOTICE, remoteQuoteParagraphs } from "@/lib/remoteQuoteClause";
import QuoteTermsPage from "@/components/quoting/QuoteTermsPage";

const text = (o: Parameters<typeof buildTermsBlocks>[0]) => buildTermsBlocks(o).map((b) => b.text).join("\n");

describe("remote quote clause (section 12)", () => {
  it("is absent on normal quotes and present on remote quotes", () => {
    expect(text({ companyName: "Massair CT (Pty) Ltd" })).not.toContain("Quotes made by phone or online");
    const t = text({ companyName: "Massair CT (Pty) Ltd", remoteQuote: true });
    expect(t).toContain("Quotes made by phone or online:");
    for (const p of remoteQuoteParagraphs()) expect(t).toContain(p);
    expect(t).toContain("refund your deposit in full");
    expect(t).not.toMatch(/call-out/i);
  });
  it("also appends to a company's custom terms text", () => {
    expect(text({ customText: "PAYMENT:\n\nPay us.", remoteQuote: true })).toContain("12.4 Your installation costs");
  });
  it("never uses t/a or the old 0800 number", () => {
    const t = text({ companyName: "Massair CT (Pty) Ltd", remoteQuote: true }) + REMOTE_QUOTE_NOTICE;
    expect(t).not.toMatch(/\bt\/a\b/i);
    expect(t).not.toContain("0800 232 665");
  });
  it("2.1 payment: new wording for new quotes, old wording kept for quotes issued before the change", () => {
    expect(text({})).toContain(PAYMENT_21);
    expect(PAYMENT_21).toMatch(/70% deposit/);
    expect(PAYMENT_21).toMatch(/units-only orders.*full payment/);
    expect(text({ legacyPayment: true })).toContain("paid in full as acceptance of our quotation");
    expect(usesLegacyPaymentTerms("2026-10-16T12:00:00Z")).toBe(true);
    expect(usesLegacyPaymentTerms("2026-10-18T20:30:00Z")).toBe(false);
    expect(usesLegacyPaymentTerms(null)).toBe(false);
  });
  it("short notice: only on remote quotes, added once", () => {
    expect(withRemoteNotice("Valid 30 days.", false)).toBe("Valid 30 days.");
    const once = withRemoteNotice("Valid 30 days.", true);
    expect(once).toContain(REMOTE_QUOTE_NOTICE);
    expect(withRemoteNotice(once, true)).toBe(once);
  });
  it("terms page renders section 12 only when flagged", () => {
    expect(renderToString(<QuoteTermsPage companyName="Massair CT (Pty) Ltd" />)).not.toContain("phone or online");
    expect(renderToString(<QuoteTermsPage companyName="Massair CT (Pty) Ltd" remoteQuote />)).toContain("Quotes made by phone or online");
  });
});
