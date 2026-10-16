import { Button } from "@/components/ui/button";
import { Copy, MessageCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatRand } from "@/utils/formatRand";
import { buildDepositWhatsAppUrl } from "@/lib/depositShare";
import type { DepositInvoiceRow } from "@/lib/depositInvoice";
import { cleanBanking } from "@/lib/companyIdentity";
import { profileBanking, type CompanyProfile } from "@/lib/companyProfiles";

interface ClientDepositActionsProps {
  invoice: DepositInvoiceRow;
  payUrl: string;
  /** Company banking (settings) — fallback only. */
  banking?: unknown;
  /** The quote company's own record — banking comes from here first. */
  profile?: Partial<CompanyProfile> | null;
}

/**
 * Client-facing block on the public quote page after accept (oneinv, Johan 2026-10-16):
 * ONE invoice: total, deposit due now, balance on completion, EFT banking details from the
 * company's own record and a copyable payment reference. No payment gateway here.
 */
const ClientDepositActions = ({ invoice, payUrl, banking, profile }: ClientDepositActionsProps) => {
  const { toast } = useToast();
  const total = Number(invoice.grand_total) || 0;
  const dep = Number(invoice.deposit_amount) || 0;
  const depositDue = dep > 0 && dep < total ? dep : total;
  const invoiceNumber = invoice.invoice_number || "Deposit";
  const s = cleanBanking(banking);
  const r = profileBanking(profile);
  const b = {
    account_name: r?.account_name || profile?.legal_name || s.account_name || "",
    bank_name: r?.bank_name || s.bank_name || "",
    account_number: r?.account_number || s.account_number || "",
    branch_code: r?.branch_code || s.branch_code || "",
    account_type: r?.account_type || s.account_type || "",
  };
  const copy = async (text: string, what: string) => {
    await navigator.clipboard.writeText(text);
    toast({ title: `${what} copied` });
  };
  const row = (label: string, value?: string) =>
    value ? (
      <div className="flex justify-between gap-3"><span className="text-slate-500">{label}</span><span className="font-medium text-slate-900 text-right">{value}</span></div>
    ) : null;

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-3">
      <div className="w-full rounded-xl border border-emerald-200 bg-white p-4 text-left text-sm space-y-1.5">
        <p className="font-semibold text-emerald-800">Invoice {invoiceNumber}</p>
        {row("Total (incl. VAT)", formatRand(total))}
        {depositDue < total && row("Deposit due now", formatRand(depositDue))}
        {depositDue < total && row("Balance on completion", formatRand(Math.max(0, total - depositDue)))}
        {(b.account_number || b.bank_name) && (
          <div className="mt-3 border-t border-slate-200 pt-3 space-y-1.5">
            <p className="font-semibold text-slate-900">Pay by EFT</p>
            {row("Account name", b.account_name)}
            {row("Bank", b.bank_name)}
            {row("Account type", b.account_type)}
            {row("Account number", b.account_number)}
            {row("Branch code", b.branch_code)}
            {row("Reference", invoiceNumber)}
          </div>
        )}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => copy(invoiceNumber, "Reference")}>
          <Copy className="mr-2 h-4 w-4" /> Copy reference
        </Button>
        {b.account_number && (
          <Button type="button" variant="outline" size="sm" onClick={() => copy(b.account_number, "Account number")}>
            <Copy className="mr-2 h-4 w-4" /> Copy account number
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" asChild>
          <a href={buildDepositWhatsAppUrl(invoiceNumber, depositDue, payUrl)} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="mr-2 h-4 w-4" /> Share on WhatsApp
          </a>
        </Button>
      </div>
    </div>
  );
};

export default ClientDepositActions;
