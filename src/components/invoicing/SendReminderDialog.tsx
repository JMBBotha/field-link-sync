import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import FinalInvoiceSendDialog from "@/components/invoicing/FinalInvoiceSendDialog";
import { InvoicePicker, type UnpaidInvoice } from "@/components/invoicing/AddPaymentDialog";

/** Send reminder from the balance block / client tiles (Johan 2 Nov 17:00).
 *  Reuses the invoice send flow (FinalInvoiceSendDialog, reminder wording): preview first, nothing sends until Send. */
export default function SendReminderDialog({ open, onOpenChange, invoices, initialId, onDone }: {
  open: boolean; onOpenChange: (v: boolean) => void; invoices: UnpaidInvoice[]; initialId?: string | null; onDone?: () => void;
}) {
  const [pick, setPick] = useState<string | null>(null);
  const [inv, setInv] = useState<any>(null);
  useEffect(() => { if (open) { setInv(null); setPick(initialId ?? (invoices.length === 1 ? invoices[0].id : null)); } }, [open, initialId, invoices]);
  useEffect(() => {
    if (!open || !pick) return; let live = true;
    supabase.from("invoices").select("id, invoice_number, customer_name, customer_phone, customer_email, due_date, pdf_url, final_sent_at, final_sent_channel").eq("id", pick).maybeSingle()
      .then(({ data }) => { if (live) setInv(data); });
    return () => { live = false; };
  }, [open, pick]);
  const row = invoices.find((i) => i.id === pick);
  const balance = row?.amount_due ?? 0;
  if (open && pick && inv) {
    return <FinalInvoiceSendDialog reminder hideTrigger open invoice={inv} balance={balance} onOpenChange={(o) => { if (!o) onOpenChange(false); }} onDone={onDone} />;
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
