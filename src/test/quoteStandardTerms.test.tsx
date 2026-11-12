import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { renderToString } from "react-dom/server";
import EstimateDocument from "@/components/quoting/EstimateDocument";
import { fillStandardTerms, standardTermsPlain, standardTermsTemplate } from "@/lib/defaultTerms";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }), auth: { getUser: async () => ({ data: { user: null } }) } },
}));
vi.mock("@/hooks/useCompanySettings", () => ({
  useCompanySettings: () => ({ settings: { company_name: "Wrong Co", banking_details: {}, default_deposit_percentage: 70, default_payment_terms_days: 0 } }),
}));
vi.mock("@/hooks/useDocumentCompanyProfile", () => ({
  useDocumentCompanyProfile: () => ({
    company_id: "361bf031-9cdb-4d7f-9bde-9eb95fa4725e",
    legal_name: "Massair CT (Pty) Ltd",
    bank_name: "FNB",
    account_name: "Massair CT (Pty) Ltd",
    account_number: "63226563591",
    branch_code: "250 655",
    account_type: "Cheque",
  }),
}));

const CT = {
  companyName: "Massair CT (Pty) Ltd",
  accountName: "Massair CT (Pty) Ltd",
  bankName: "FNB",
  accountType: "Cheque",
  accountNumber: "63226563591",
  branchCode: "250 655",
};

describe("Massair CT quote terms", () => {
  it("prints the standard terms page when the quote has no stored terms_text", () => {
    const html = renderToString(
      <EstimateDocument
        estimateNumber="Q-2026-0099"
        issueDate="2026-11-12"
        customerName="Cape Estates"
        items={[{ description: "Samsung 12000 BTU\nSupply and install", quantity: 1, unit_price: 8500, amount: 8500 }]}
        subtotal={8500}
        taxRate={0.15}
        taxAmount={1275}
        grandTotal={9775}
        termsText={null}
        companyId="361bf031-9cdb-4d7f-9bde-9eb95fa4725e"
        companyProfile={{ company_id: "361bf031-9cdb-4d7f-9bde-9eb95fa4725e", legal_name: "Massair CT (Pty) Ltd", bank_name: "FNB", account_name: "Massair CT (Pty) Ltd", account_number: "63226563591", branch_code: "250 655", account_type: "Cheque" }}
      />,
    );
    expect(html).toContain('data-testid="quote-terms-page"');
    expect(html).toContain("Terms and conditions");
    expect(html).toContain("1.1 Thank you for considering Massair CT (Pty) Ltd");
    expect(html).toContain("63226563591");
    expect(html).toContain("Q-2026-0099");
  });

  it("keeps terms ink dark on the white paper so a dark theme cannot blank the PDF", () => {
    const css = readFileSync("src/index.css", "utf8");
    expect(css).toMatch(/\.bd,\s*\.fl-terms-page\{[^}]*--text-primary:\s*215 30% 18%/);
    const page = readFileSync("src/components/quoting/QuoteTermsPage.tsx", "utf8");
    expect(page).toContain("fl-terms-page");
  });

  it("writes the Massair CT clause into a PDF", async () => {
    const { standardTermsPdfBytes } = await import("@/lib/documentPdf");
    const bytes = standardTermsPdfBytes(CT);
    const raw = Buffer.from(bytes).toString("latin1");
    expect(raw).toContain("Thank you for considering Massair CT");
    expect(raw).toContain("63226563591");
    expect(raw).toContain("Consumer Protection Act");
  });

  it("stores the same wording the terms page prints, with company placeholders", () => {
    const template = standardTermsTemplate();
    const filled = fillStandardTerms(template, CT);
    expect(filled).toContain("1.1 Thank you for considering Massair CT (Pty) Ltd");
    expect(filled).toContain("7.4 Account Number: 63226563591");
    expect(filled).not.toContain("{company}");
    expect(filled).not.toContain("{account}");
    const sql = readFileSync("supabase/migrations/20261112113000_quote_standard_terms.sql", "utf8");
    expect(sql).toContain(template);
    expect(sql).toContain("NEW.terms_text := public.fl_standard_terms_for_company(NEW.company_id)");
    const backfill = readFileSync("docs/db-releases/2026-11-12_draft_quote_terms_backfill.sql", "utf8");
    expect(backfill).toContain("status::text = 'draft'");
    expect(backfill).not.toMatch(/UPDATE public\.invoices/i);
    expect(backfill).toContain("terms_text IS NULL");
    expect(standardTermsPlain(CT).length).toBeGreaterThan(5000);
  });
});
