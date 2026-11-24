import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import InvoiceDocument from "@/components/invoicing/InvoiceDocument";
import EstimateDocument from "@/components/quoting/EstimateDocument";
import DocumentChoiceDialog from "@/components/documents/DocumentChoiceDialog";
import PreviewClickSurface from "@/components/documents/PreviewClickSurface";
import { invoicePreviewChoices, quotePreviewChoices, type PreviewChoice } from "@/lib/documentPreviewChoices";

const LINES = [
  { description: "Samsung 12000 BTU midwall\nLounge", quantity: 1, unit_price: 8450, amount: 8450 },
  { description: "Standard installation", quantity: 1, unit_price: 2800, amount: 2800 },
];

/**
 * Signed-out sample of the document tap-choice. Nothing here is saved.
 * /dev/document-choice?kind=invoice|quote&mode=draft|locked&open=1
 */
export default function DocumentChoiceHarness() {
  const [sp] = useSearchParams();
  const kind = sp.get("kind") === "quote" ? "quote" : "invoice";
  const locked = sp.get("mode") === "locked";
  const [open, setOpen] = useState(sp.get("open") === "1");
  const [picked, setPicked] = useState<string | null>(null);
  const choices: PreviewChoice[] = kind === "invoice"
    ? invoicePreviewChoices({ status: locked ? "sent" : "draft", companyWritable: true, canCreditNote: locked })
    : quotePreviewChoices({
        companyWritable: true,
        canEdit: !locked,
        canUnlock: locked,
        canRelock: false,
        canVariation: locked,
        canCorrectClient: locked,
        lockActionsLive: locked,
      });
  const editClass = "h-11 w-full rounded-lg bg-[#C2410C] font-semibold text-white hover:bg-[#9A3412] sm:w-auto";

  return (
    <div className="v8-scope mx-auto max-w-4xl space-y-3 p-4" data-testid="document-choice-harness">
      <h1 className="text-lg font-bold">{kind === "invoice" ? "Invoice INV-1042" : "Estimate Q-1042"}</h1>
      {!locked && kind === "invoice" && (
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 px-1 text-sm" data-testid="due-date-edit">
          <span className="text-muted-foreground">Due 30 Nov 2026</span>
          <Button type="button" size="sm" variant="link" className="h-8 px-1">Change</Button>
          <div className="w-full sm:ml-auto sm:w-auto">
            <Button type="button" data-testid="invoice-edit-top" className={editClass} onClick={() => setPicked("edit")}>
              <Pencil className="mr-2 h-4 w-4" /> Edit invoice
            </Button>
          </div>
        </div>
      )}
      {!locked && kind === "quote" && (
        <div data-testid="quote-top-actions">
          <Button type="button" data-testid="quote-edit-top" className={editClass} onClick={() => setPicked("full-builder")}>
            <Pencil className="mr-2 h-4 w-4" /> Full builder
          </Button>
        </div>
      )}
      {locked && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {kind === "invoice" ? "Sent invoices are locked. Duplicate it, or use a credit note." : "Locked: accepted. Extra work goes on a variation."}
        </p>
      )}
      <PreviewClickSurface enabled label={kind === "invoice" ? "Invoice options" : "Quote options"} onOpen={() => setOpen(true)}>
        {kind === "invoice" ? (
          <InvoiceDocument
            invoiceNumber="INV-1042"
            status={locked ? "sent" : "draft"}
            issueDate="2026-11-01"
            dueDate="2026-11-30"
            customerName="A. Nkosi"
            customerAddress="14 Oak Street, Cape Town"
            items={LINES}
            subtotal={11250}
            taxRate={15}
            taxAmount={1687.5}
            grandTotal={12937.5}
            notes="Lounge installation."
          />
        ) : (
          <EstimateDocument
            estimateNumber="Q-1042"
            issueDate="2026-11-01"
            validUntil="2026-11-30"
            customerName="A. Nkosi"
            customerAddress="14 Oak Street, Cape Town"
            items={LINES.map((line) => ({ description: line.description, quantity: line.quantity, unit_price: line.unit_price, amount: line.amount }))}
            subtotal={11250}
            taxRate={0.15}
            taxAmount={1687.5}
            grandTotal={12937.5}
            notes="Lounge installation."
            companyOverride={{ company_name: "Sample Air", default_deposit_percentage: 70, default_payment_terms_days: 30, banking_details: {} }}
            collapseTerms
          />
        )}
      </PreviewClickSurface>
      {picked && <p data-testid="harness-picked">Opened: {picked}</p>}
      <DocumentChoiceDialog
        open={open}
        onOpenChange={setOpen}
        title={kind === "invoice" ? (locked ? "Invoice" : "Draft invoice") : (locked ? "Locked quote" : "Quote")}
        choices={choices}
        onSelect={(id) => { setPicked(id); setOpen(false); }}
      />
    </div>
  );
}
