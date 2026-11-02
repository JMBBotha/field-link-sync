import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PaymentReminderDialog } from "@/components/invoicing/PaymentReminderDialog";
import { InvoicePicker, type UnpaidInvoice } from "@/components/invoicing/AddPaymentDialog";

/** Send reminder from the balance block / client tiles (Johan 2 Nov 17:00).
 *  Friendly payment-reminder email (own subject + wording, send_invoice_reminder): preview first, nothing sends until Send. */
export default function SendReminderDialog({ open, onOpenChange, invoices, initialId, onDone }: {
  open: boolean; onOpenChange: (v: boolean) => void; invoices: UnpaidInvoice[]; initialId?: string | null; onDone?: () => void;
}) {
  const [pick, setPick] = useState<string | null>(null);
  useEffect(() => { if (open) setPick(initialId ?? (invoices.length === 1 ? invoices[0].id : null)); }, [open, initialId, invoices]);
  if (open && pick) {
    return <PaymentReminderDialog invoiceId={pick} open onOpenChange={(o) => { if (!o) onOpenChange(false); }} onSent={onDone} />;
  }
  return (
    <Dialog open={open && !pick} onOpenChange={onOpenChange}>
      <DialogContent data-testid="send-reminder-picker-dialog" className="w-[calc(100vw-1.5rem)] max-w-lg rounded-2xl p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Send reminder</DialogTitle>
          <DialogDescription>Which invoice is the reminder for?</DialogDescription>
        </DialogHeader>
        <InvoicePicker invoices={invoices} pick={pick} onPick={setPick} />
      </DialogContent>
    </Dialog>
  );
}
