/**
 * Record actions moved from the archived estimate page into the ONE quote builder (Johan 09:49):
 * status, deposit chip, staff row menu, Convert to Invoice (accepted only).
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCheck2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import StatusPill from "@/components/shared/StatusPill";
import RowMenu from "@/components/shared/RowMenu";
import DepositPaymentChip from "@/components/shared/DepositPaymentChip";
import { useQuoteStaffActions } from "@/components/quoting/useQuoteStaffActions";
import { convertQuoteToInvoice } from "@/lib/convertQuoteToInvoice";
import { fetchQuoteInvoice } from "@/lib/depositInvoice";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export default function QuoteRecordStrip({ quote, checkLabour }: { quote: any; checkLabour?: any }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  const staffActions = useQuoteStaffActions(undefined, checkLabour);
  const [busy, setBusy] = useState(false);
  const accepted = String(quote?.status || "").toLowerCase() === "accepted";
  const { data: depositInvoice } = useQuery({
    queryKey: ["quote-deposit-invoice", quote?.id], enabled: !!quote?.id && accepted, queryFn: () => fetchQuoteInvoice(quote.id),
  });
  if (!quote?.id) return null;
  const items = staffActions.itemsFor(quote).filter((i: any) => !i.hidden);
  const convert = async () => {
    if (!user?.id) return;
    setBusy(true);
    try {
      const invoiceId = await convertQuoteToInvoice(quote.id, user.id);
      qc.invalidateQueries({ queryKey: ["quotes"] }); qc.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: "Invoice created", description: "Draft invoice generated from estimate." });
      navigate(`/admin/invoices?highlight=${invoiceId}`);
    } catch (e: any) { toast({ title: e.message || "Conversion failed", variant: "destructive" }); }
    setBusy(false);
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-sm print:hidden" data-testid="quote-record-strip">
      <span className="text-xs text-muted-foreground">Status</span>
      <StatusPill status={quote.status} />
      {accepted && <DepositPaymentChip invoice={depositInvoice} accepted />}
      <span className="ml-auto flex items-center gap-2">
        {accepted && (
          <Button size="sm" variant="brand" className="h-8" onClick={convert} disabled={busy}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileCheck2 className="mr-1 h-4 w-4" />}Convert to Invoice
          </Button>
        )}
        {items.length > 0 && <RowMenu items={items.map((i: any) => ({ ...i, separatorBefore: false }))} />}
      </span>
      {staffActions.dialogs}
    </div>
  );
}
