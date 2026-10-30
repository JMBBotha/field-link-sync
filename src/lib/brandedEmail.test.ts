import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { renderBrandedEmail, finalInvoiceBodyHtml, brandedTransactionalFooter, EMAIL_BRAND } from "./brandedEmail";
import L from "./brandedEmail.fixture.json";

describe("shared branded client email (latest approved V8 design)", () => {
  it("front-end and edge copies are identical", () => {
    expect(readFileSync("src/lib/brandedEmail.ts", "utf8")).toBe(readFileSync("supabase/functions/_shared/brandedEmail.ts", "utf8"));
  });
  const html = renderBrandedEmail({ brand: L.brand as any, title: L.title, kicker: L.kicker, greetingName: L.greeting_name,
    bodyHtml: finalInvoiceBodyHtml(L.data as any), footerHtml: brandedTransactionalFooter(L.brand.name) });
  it("uses the exact V8 blue and an absolute https logo", () => {
    expect(EMAIL_BRAND.blue).toBe("#0B4FA8");
    expect(html).toContain("#0B4FA8");
    expect(html).toContain('src="https://field-link-sync.lovable.app/email/logo-white.png"');
  });
  it("keeps balance, pay link, company details and terms; no Ind CC / 0800 232 665", () => {
    for (const t of ["Hi Sam,", "R 6 412,20", "R 14 961,80", "View &amp; pay invoice", "Massair CT (Pty) Ltd", "WARRANTY"]) expect(html).toContain(t);
    expect(html).not.toMatch(/Ind CC|232[\s-]*665/i);
  });
});
