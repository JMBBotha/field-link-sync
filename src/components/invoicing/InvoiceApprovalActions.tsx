import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Send, Pencil, PauseCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInvoiceApprovals } from "@/hooks/useInvoiceApprovals";
import type { ApprovalStatus } from "@/lib/invoiceSendApproval";

export const EDIT_HOLD_REASON = "Opened to edit";

/**
 * "Send invoice now" · "Edit" · "Hold" for one accepted-quote invoice. Used by the attention panel and the bell.
 * Edit pauses the auto-send (holds it) so a half-edited invoice never goes out, then opens the invoice.
 */
export default function InvoiceApprovalActions({ invoiceId, status = "pending", onDone, className }: {
  invoiceId: string; status?: ApprovalStatus; onDone?: () => void; className?: string;
}) {
  const navigate = useNavigate();
  const { sendNow, hold } = useInvoiceApprovals(false);
  const [busy, setBusy] = useState<null | "send" | "hold" | "edit">(null);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const act = async (k: "send" | "hold" | "edit") => {
    if (busy) return;
    if (k === "hold") {
      const reason = window.prompt("Hold this invoice? It won't send until someone sends it.\nReason (optional):", "");
      if (reason === null) return;
      setBusy(k); await hold(invoiceId, reason); setBusy(null); onDone?.(); return;
    }
    setBusy(k);
    if (k === "send") await sendNow(invoiceId);
    else { if (status === "pending") await hold(invoiceId, EDIT_HOLD_REASON); navigate(`/admin/invoices/${invoiceId}`); }
    setBusy(null); onDone?.();
  };
  return (
    <div className={className ?? "flex flex-wrap gap-1"} onClick={stop} data-testid="invoice-approval-actions">
      <Button size="sm" className="h-7 bg-[#1590d6] px-2 text-xs text-white hover:bg-[#1287c9]" disabled={!!busy} onClick={() => act("send")}>
        <Send className="mr-1 h-3 w-3" />{busy === "send" ? "Sending…" : "Send invoice now"}
      </Button>
      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={!!busy} onClick={() => act("edit")}>
        <Pencil className="mr-1 h-3 w-3" />Edit
      </Button>
      {status === "pending" && (
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!!busy} onClick={() => act("hold")}>
          <PauseCircle className="mr-1 h-3 w-3" />Hold
        </Button>
      )}
    </div>
  );
}
