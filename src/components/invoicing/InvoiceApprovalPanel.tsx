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
