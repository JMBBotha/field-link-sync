import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import PaymentRecorder from "@/components/invoicing/PaymentRecorder";
import { creditedByInvoice, fetchCreditNotes, type CreditNoteRow } from "@/lib/creditNotes";
import { cn } from "@/lib/utils";

export type UnpaidInvoice = { id: string; invoice_number: string | null; grand_total: number; amount_due: number; days?: number; waiting?: boolean };
const rand = (n: number) => new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

/** Add payment from the client page (Johan 2 Nov 16:42). Same recorder as the invoice page "Record payment".
 *  One unpaid invoice opens straight away; several show a picker (oldest first). */
export default function AddPaymentDialog({ open, onOpenChange, invoices, initialId, onDone }: {
  open: boolean; onOpenChange: (v: boolean) => void; invoices: UnpaidInvoice[]; initialId?: string | null; onDone?: () => void;
}) {
  const [pick, setPick] = useState<string | null>(null);
  const [credits, setCredits] = useState<CreditNoteRow[]>([]);
  useEffect(() => { if (open) setPick(initialId ?? (invoices.length === 1 ? invoices[0].id : null)); }, [open, initialId, invoices]);
  useEffect(() => { if (!pick) return; let live = true; fetchCreditNotes([pick]).then((c) => { if (live) setCredits(c); }).catch(() => {}); return () => { live = false; }; }, [pick]);
  const inv = invoices.find((i) => i.id === pick) || null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="add-payment-dialog" className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-1.5rem)] max-w-lg overflow-y-auto rounded-2xl p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Add payment</DialogTitle>
          <DialogDescription>{inv ? `${inv.invoice_number || "Invoice"} · ${rand(inv.amount_due)} due` : "Which invoice is this payment for?"}</DialogDescription>
        </DialogHeader>
        {invoices.length > 1 && <InvoicePicker invoices={invoices} pick={pick} onPick={setPick} />}
        {inv && (
          <PaymentRecorder key={inv.id} invoiceId={inv.id} invoiceTotal={Number(inv.grand_total)} credited={creditedByInvoice(credits).get(inv.id) || 0} onChange={() => onDone?.()} />
        )}
      </DialogContent>
    </Dialog>
  );
}

export function InvoicePicker({ invoices, pick, onPick }: { invoices: UnpaidInvoice[]; pick: string | null; onPick: (id: string) => void }) {
  return (
    <div className="space-y-1.5" data-testid="add-payment-picker" role="radiogroup">
      {invoices.map((i) => (
        <button key={i.id} type="button" role="radio" aria-checked={pick === i.id} onClick={() => onPick(i.id)}
          className={cn("flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm", pick === i.id ? "border-[#1AA7EC] bg-[#E8F6FE]" : "bg-card")}>
          <span className="font-semibold">{i.invoice_number || "Invoice"}</span>
          <span className="text-right">{rand(i.amount_due)} due{i.days && i.days > 0 ? <span className="ml-1 text-[#C9373C]">· {i.days}d late</span> : null}</span>
        </button>
      ))}
    </div>
  );
}
