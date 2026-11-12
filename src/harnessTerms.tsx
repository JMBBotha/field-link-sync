/** Demo harness only. Sample Massair CT quote. Not a live quote and not a database write. */
import "./index.css";
import { createRoot } from "react-dom/client";
import QuoteTermsPage from "@/components/quoting/QuoteTermsPage";
import { ORIGINAL_TERMS_TEXT } from "@/lib/originalTerms";
import BrandDocument from "@/components/documents/BrandDocument";

const CT = "361bf031-9cdb-4d7f-9bde-9eb95fa4725e";

function Page() {
  return (
    <div className="min-h-screen bg-[#F3F6FA] p-4" data-testid="harness-terms">
      <p className="mx-auto mb-3 max-w-[820px] rounded-lg bg-[#3D9BE8] px-3 py-2 text-sm font-semibold text-white">
        Demo harness, sample quote. Not a live quote. Terms page as the PDF prints it.
      </p>
      <div className="mx-auto w-[820px] bg-white shadow-sm" data-testid="harness-terms-sheet">
        <BrandDocument
          docType="quote"
          captureRoot="estimate"
          title="QUOTATION"
          number="Q-2026-0099"
          profile={{
            company_id: CT,
            legal_name: "Massair CT (Pty) Ltd",
            vat_number: "4630313080",
            phone: "(021) 802-2889",
            email: "info@0800becool.co.za",
            website: "www.0800becool.co.za",
            whatsapp: "069 683 8624",
            bank_name: "FNB",
            account_name: "Massair CT (Pty) Ltd",
            account_number: "63226563591",
            branch_code: "250 655",
            account_type: "Cheque",
            address_lines: ["9A Cabernet Rd, Blackheath Ind", "Cape Town", "7580"],
          }}
          partyLabel="Prepared for"
          partyName="Cape Estates"
          partyLines={["12 Oak Road", "Cape Town"]}
          meta={[["Quote No", "Q-2026-0099"], ["Date", "12 Nov 2026"], ["Valid until", "30 days"]]}
          sections={[{
            key: "lounge",
            title: "Lounge",
            lines: [{ key: "1", quantity: "1", name: "Samsung 12000 BTU midwall", description: "Supply and install", rate: 8500, total: 8500 }],
          }]}
          totals={[{ label: "Subtotal excl VAT", value: 8500 }, { label: "VAT 15%", value: 1275 }]}
          grandLabel="Quote total incl VAT"
          grandTotal={9775}
          cards={[
            { title: "Payment", body: <p>70% deposit on acceptance. Balance on completion.</p> },
            { title: "Banking", body: <p>FNB · 63226563591 · Branch 250 655. Reference: quote number.</p> },
          ]}
          fullTermsPage={
            <QuoteTermsPage
              companyName="Massair CT (Pty) Ltd"
              quoteNumber="Q-2026-0099"
              sourceText={ORIGINAL_TERMS_TEXT}
              rowFlow
            />
          }
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Page />);
