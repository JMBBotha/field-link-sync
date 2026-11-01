import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useInvoiceApprovals } from "@/hooks/useInvoiceApprovals";
import { useNow } from "@/hooks/useLeadSla";
import { alertTitle, fmtRand, statusLine, type InvoiceSendApproval } from "@/lib/invoiceSendApproval";
import InvoiceApprovalActions from "./InvoiceApprovalActions";

/** Presentational list (tested directly). */
export function InvoiceApprovalList({ items, now, className }: { items: InvoiceSendApproval[]; now: number; className?: string }) {
  if (!items.length) return null;
  return (
    <section data-testid="invoice-approvals" className={cn("rounded-xl border border-[#1590d6]/40 bg-[#1590d6]/5 p-2", className)}>
      <h3 className="flex items-center gap-1.5 px-1 text-xs font-bold tracking-wide text-[#1590d6]">
        <CheckCircle2 className="h-3.5 w-3.5" /> ACCEPTED · INVOICE TO SEND ({items.length})
      </h3>
      <ul className="mt-1 divide-y divide-border">
        {items.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-2 py-1.5" data-testid={`invoice-approval-${a.status}`}>
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold",
              a.status === "pending" ? "bg-[#1590d6] text-white" : a.status === "blocked" ? "bg-[#F97316] text-white" : "bg-muted text-muted-foreground")}>
              {a.status === "pending" ? "Accepted" : a.status === "blocked" ? "Not sent" : "On hold"}
            </span>
            <span className="min-w-0 flex-1 text-xs">
              <span className="block truncate font-semibold">{alertTitle(a)}</span>
              <span className="block text-muted-foreground">
                {a.invoice_number || "Invoice"} · deposit {fmtRand(a.deposit_amount)} · {statusLine(a, now)}
              </span>
            </span>
            <InvoiceApprovalActions invoiceId={a.invoice_id} status={a.status} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Accepted quotes whose deposit invoice is waiting to go out. Only the quote's rep and that company's admins see rows (RLS). */
export default function InvoiceApprovalPanel({ className }: { className?: string }) {
  const now = useNow();
  const { items } = useInvoiceApprovals();
  return <InvoiceApprovalList items={items} now={now} className={className} />;
}

/** UI polish (Johan 1 Nov 20:58): bold orange card on sales home + admin dashboard whenever ≥1 invoice waits.
 *  Shows count + total incl. VAT. "Review & send" only opens the waiting list; it never sends by itself. */
export function InvoiceApprovalCard({ items, now }: { items: InvoiceSendApproval[]; now: number }) {
  const [open, setOpen] = useState(false);
  const waiting = items.filter((a) => a.status === "pending" || a.status === "blocked" || a.status === "held");
  if (!waiting.length) return null;
  const total = waiting.reduce((t, a) => t + Number(a.deposit_amount || 0), 0);
  return (
    <>
      <section data-testid="invoice-approval-card" className="flex flex-wrap items-center gap-3 rounded-xl bg-[#F97316] p-4 text-[#0F1B2A] shadow-sm">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold uppercase tracking-wide">Invoices waiting to send</div>
          <div className="text-[22px] font-extrabold leading-tight tabular-nums">{waiting.length} · {fmtRand(total)} <span className="text-[13px] font-semibold">incl. VAT</span></div>
        </div>
        <button type="button" data-testid="invoice-approval-review" onClick={() => setOpen(true)} className="min-h-[44px] rounded-[10px] bg-[#9A3412] px-5 text-[16px] font-bold text-white ring-2 ring-white/70 hover:bg-[#7C2D12]">Review &amp; send</button>
      </section>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg" data-testid="invoice-approval-review-list">
          <DialogHeader><DialogTitle>Invoices waiting · {waiting.length}</DialogTitle></DialogHeader>
          <p className="text-[13px] text-muted-foreground">Nothing is sent from this list until you tap Send on a row.</p>
          <InvoiceApprovalList items={waiting} now={now} className="border-0 bg-transparent p-0" />
        </DialogContent>
      </Dialog>
    </>
  );
}

export function InvoiceApprovalHomeCard() {
  const now = useNow();
  const { items } = useInvoiceApprovals();
  return <InvoiceApprovalCard items={items} now={now} />;
}
