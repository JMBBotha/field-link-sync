import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { renderToString } from "react-dom/server";
import EstimateDocument from "@/components/quoting/EstimateDocument";
import { standardTermsTemplate } from "@/lib/defaultTerms";
import { ORIGINAL_TERMS_CORRECTIONS, ORIGINAL_TERMS_TEXT } from "@/lib/originalTerms";

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
    expect(html).toContain("Should you, the client");
    expect(html).toContain("63226563591");
    expect(html).toContain("FNB");
    expect(html).toContain("Q-2026-0099");
    expect(html).not.toContain("Should u the client");
    expect(html).not.toContain("Massair Ind");
    expect(html).not.toContain("Thank you for considering");
  });

  it("keeps terms ink dark on the white paper so a dark theme cannot blank the PDF", () => {
    const css = readFileSync("src/index.css", "utf8");
    expect(css).toMatch(/\.bd,\s*\.fl-terms-page\{[^}]*--text-primary:\s*215 30% 18%/);
    const page = readFileSync("src/components/quoting/QuoteTermsPage.tsx", "utf8");
    expect(page).toContain("fl-terms-page");
  });

  it("writes the original Massair CT wording into a PDF", async () => {
    const { originalTermsPdfBytes } = await import("@/lib/documentPdf");
    const raw = Buffer.from(originalTermsPdfBytes()).toString("latin1");
    expect(raw).toContain("Should you, the client");
    expect(raw).toContain("63226563591");
    expect(raw).toContain("FNB");
    expect(raw).not.toContain("Should u the client");
    expect(raw).not.toContain("Massair Ind");
  });

  it("stores the imported wording, with only the listed corrections", () => {
    expect(standardTermsTemplate()).toBe(ORIGINAL_TERMS_TEXT);
    expect(ORIGINAL_TERMS_TEXT).toContain("1.1 Should you, the client");
    expect(ORIGINAL_TERMS_TEXT).toContain("6.5 Branch Code: 250 655");
    expect(ORIGINAL_TERMS_TEXT).toContain("Regular servicing plays a vital role");
    expect(ORIGINAL_TERMS_TEXT).not.toContain("[250 655]");
    expect(ORIGINAL_TERMS_CORRECTIONS).toHaveLength(3);
    const sql = readFileSync("supabase/migrations/20261112113000_quote_standard_terms.sql", "utf8");
    expect(sql).toContain(ORIGINAL_TERMS_TEXT);
    expect(sql).toContain("fl_master_company_id()");
    const backfill = readFileSync("docs/db-releases/2026-11-12_draft_quote_terms_backfill.sql", "utf8");
    expect(backfill).toContain("status::text = 'draft'");
    expect(backfill).toContain("fl_master_company_id()");
    expect(backfill).not.toMatch(/UPDATE public\.invoices/i);
    expect(backfill).toContain("terms_text IS NULL");
  });
});
