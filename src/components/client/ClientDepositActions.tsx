import { Button } from "@/components/ui/button";
import { Copy, MessageCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatRand } from "@/utils/formatRand";
import { buildDepositWhatsAppUrl } from "@/lib/depositShare";
import type { DepositInvoiceRow } from "@/lib/depositInvoice";

interface ClientDepositActionsProps {
  invoice: DepositInvoiceRow;
  payUrl: string;
}

/**
 * Client-facing deposit block on the public quote page after accept:
 * "Invoice INV-017 · R9 774,60" plus Copy payment link and Share on WhatsApp.
 */
const ClientDepositActions = ({ invoice, payUrl }: ClientDepositActionsProps) => {
  const { toast } = useToast();
  const amount = Number(invoice.grand_total) || 0;
  const invoiceNumber = invoice.invoice_number || "Deposit";

  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-sm font-semibold text-emerald-800">
        Invoice {invoiceNumber} · {formatRand(amount)}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(payUrl);
            toast({ title: "Payment link copied" });
          }}
        >
          <Copy className="mr-2 h-4 w-4" /> Copy payment link
        </Button>
        <Button type="button" variant="outline" size="sm" asChild>
          <a
            href={buildDepositWhatsAppUrl(invoiceNumber, amount, payUrl)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MessageCircle className="mr-2 h-4 w-4" /> Share on WhatsApp
          </a>
        </Button>
      </div>
    </div>
  );
};

export default ClientDepositActions;
