import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { COMPANY_BLOCK_LINES, cleanBanking, companyBlockHtml } from "@/lib/companyIdentity";

describe("One company block everywhere (Johan 2026-10-12)", () => {
  it("exact wording", () => {
    expect(COMPANY_BLOCK_LINES).toEqual(["Massair CT (Pty) Ltd", "(021) 802-2889", "VAT No 4630313080", "9A Cabernet Rd, Blackheath Ind", "Cape Town", "7580"]);
    expect(companyBlockHtml((s) => s)).toContain("VAT No 4630313080");
  });
  it("banking cleaned, never invented", () => {
    const b = cleanBanking({ bank_name: "FNB", account_number: "63226563591", branch_code: "250 655]", account_type: "Cheque" });
    expect(b.branch_code).toBe("250 655"); expect(b.account_name).toBe("Massair CT (Pty) Ltd");
    expect(cleanBanking({}).account_number).toBe("");
  });
  it("no old hard-coded addresses/phones left in client documents", () => {
    for (const f of ["src/components/quoting/EstimateDocument.tsx", "src/components/invoicing/InvoiceDocument.tsx", "src/components/shared/DocumentHeader.tsx",
      "src/components/QuotePDFDocument.tsx", "src/components/quoting/BrandedQuotePreview.tsx", "src/components/proposals/ProposalPreview.tsx", "src/lib/statements.ts"]) {
      const s = readFileSync(f, "utf8");
      expect(s, f).not.toMatch(/Aviation|Airport City|0800 23 2665|becool\.co\.za"|info@becool|acsuperservice/);
    }
  });
  it("Print uses the full PDF; client page has Full terms and conditions", () => {
    expect(readFileSync("src/hooks/useQuoteDocumentActions.tsx", "utf8")).toContain('const handlePrint = async () => { await handlePdf("print"); };');
    expect(readFileSync("src/components/invoicing/InvoiceDetailPage.tsx", "utf8")).toContain("printInvoicePDF(getInvoiceDataForPDF())");
    expect(readFileSync("src/components/client/ClientProposalView.tsx", "utf8")).toContain("collapseTerms"); // one "Full terms and conditions" expander inside the document (Johan 16 Oct)
  });
});
