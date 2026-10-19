import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { remoteQuoteParagraphs, isPaidInFullRemote } from "@/lib/remoteQuoteClause";
import { buildTermsBlocks, PAYMENT_21, SHOP_PAYMENT_21 } from "@/lib/defaultTerms";
import QuoteTermsPage from "@/components/quoting/QuoteTermsPage";
import { SHOP_TERMS_PARAGRAPHS, SHOP_TERMS_HEADING } from "../../supabase/functions/_shared/shopTerms";
import { REMOTE_QUOTE_HEADING } from "@/lib/remoteQuoteClause";

describe("online shop terms (12.5 payment variant)", () => {
  it("phone/Sam quotes keep the deposit wording", () => {
    const p = remoteQuoteParagraphs();
    expect(p[4]).toBe("12.5 If you do not accept the updated quotation, you may cancel and we will refund your deposit in full.");
  });
  it("shop orders say payment, nothing else changes", () => {
    const dep = remoteQuoteParagraphs();
    const pay = remoteQuoteParagraphs({ paidInFull: true });
    expect(pay[4]).toBe("12.5 If you do not accept the updated quotation, you may cancel and we will refund your payment in full.");
    expect(pay.filter((x, i) => x !== dep[i])).toHaveLength(1);
  });
  it("the website/edge copy equals the app copy", () => {
    expect(SHOP_TERMS_PARAGRAPHS).toEqual(remoteQuoteParagraphs({ paidInFull: true }));
    expect(SHOP_TERMS_HEADING).toBe(REMOTE_QUOTE_HEADING);
  });
  it("only website_shop is paid in full", () => {
    expect(isPaidInFullRemote("website_shop")).toBe(true);
    for (const s of ["phone_lead", "website_lead", "phone_call", "manual", null, undefined]) expect(isPaidInFullRemote(s as any)).toBe(false);
  });
  it("terms blocks and terms page use the variant", () => {
    const t = buildTermsBlocks({ companyName: "Massair CT (Pty) Ltd", remoteQuote: true, remotePaidInFull: true }).map((b) => b.text).join("\n");
    expect(t).toContain("refund your payment in full");
    expect(t).not.toContain("refund your deposit in full");
    expect(renderToString(<QuoteTermsPage companyName="Massair CT (Pty) Ltd" remoteQuote remotePaidInFull />)).toContain("refund your payment in full");
    expect(renderToString(<QuoteTermsPage companyName="Massair CT (Pty) Ltd" remoteQuote />)).toContain("refund your deposit in full");
  });
  it("2.1 is full payment on order for shop orders only; phone/Sam quotes keep the 70% deposit", () => {
    const shop = buildTermsBlocks({ companyName: "Massair CT (Pty) Ltd", remoteQuote: true, remotePaidInFull: true }).map((b) => b.text);
    expect(shop).toContain(SHOP_PAYMENT_21);
    expect(shop.join("\n")).not.toContain("70% deposit");
    const phone = buildTermsBlocks({ companyName: "Massair CT (Pty) Ltd", remoteQuote: true }).map((b) => b.text);
    expect(phone).toContain(PAYMENT_21);
    expect(buildTermsBlocks({ companyName: "X", legacyPayment: true }).map((b) => b.text)).not.toContain(SHOP_PAYMENT_21);
    expect(renderToString(<QuoteTermsPage companyName="Massair CT (Pty) Ltd" remoteQuote remotePaidInFull />)).toContain("Online orders are paid in full when the order is placed");
    expect(renderToString(<QuoteTermsPage companyName="Massair CT (Pty) Ltd" remoteQuote />)).toContain("70% deposit");
  });
});
