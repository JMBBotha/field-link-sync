/**
 * Signed-out preview fixture. Not a live send: the dialogs do not call the mail or WhatsApp servers.
 * Open /dev/send-preview-fixture?view=invoice|quote (dev server only).
 */
import { useSearchParams } from "react-router-dom";
import FinalInvoiceSendDialog from "@/components/invoicing/FinalInvoiceSendDialog";
import SendQuoteDialog from "@/components/quoting/SendQuoteDialog";
import { FINAL_INVOICE_DEFAULT_MESSAGE } from "@/lib/brandedEmail";
import L from "@/lib/brandedEmail.fixture.json";

const layout = {
  template: "final_invoice" as const,
  brand: L.brand,
  title: "Final invoice INV-042 - balance R 6 412,20",
  kicker: L.kicker,
  greeting_name: "Sam Testclient",
  data: L.data,
};

export default function SendPreviewFixturePage() {
  const [params] = useSearchParams();
  const view = params.get("view") === "quote" ? "quote" : "invoice";
  return (
    <div className="min-h-screen bg-[#eef3f9] p-4" data-testid="send-preview-fixture">
      <p className="mx-auto mb-3 max-w-lg rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">
        PREVIEW FIXTURE — not a live send. Nothing is emailed or sent on WhatsApp. Sample client: Sam Testclient.
      </p>
      {view === "invoice" ? (
        <FinalInvoiceSendDialog
          hideTrigger
          open
          onOpenChange={() => {}}
          invoice={{ id: "fixture-inv", invoice_number: "INV-042", customer_name: "Sam Testclient", customer_email: "sam.testclient@example.com", customer_phone: "0820000000" }}
          balance={6412.2}
          fixture={{ to: "sam.testclient@example.com", subject: layout.title, message: FINAL_INVOICE_DEFAULT_MESSAGE, layout }}
        />
      ) : (
        <SendQuoteDialog
          open
          onOpenChange={() => {}}
          quoteId=""
          quoteNumber="Q-2026-0042"
          customerId={null}
          customerName="Sam Testclient"
          previewFixture={{
            to: "sam.testclient@example.com",
            subject: "Your quote Q-2026-0042",
            message: "Thank you for the opportunity. Your quotation is ready to view online.",
            html: "<p style=\"font-family:Arial,sans-serif\">Hi Sam,</p><p style=\"font-family:Arial,sans-serif\">Thank you for the opportunity. Your quotation is ready to view online.</p><p><b>Total incl. VAT</b> R 21 374,00</p><p>PREVIEW FIXTURE — this email was not sent.</p>",
          }}
        />
      )}
    </div>
  );
}
