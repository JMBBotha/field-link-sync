import { Button } from "@/components/ui/button";
import { Mail } from "lucide-react";

/**
 * Tick bar on the invoices list. Service contracts stay. Email these is the
 * same-client send, in the V8 bar colour with the accent action.
 */
export default function InvoiceEmailBar({
  selectedCount,
  sameClientReason,
  emailCount,
  emailEnabled,
  emailReason,
  contractEnabled,
  onCancel,
  onContract,
  onEmail,
}: {
  selectedCount: number;
  sameClientReason?: string | null;
  emailCount: number;
  emailEnabled: boolean;
  emailReason?: string | null;
  contractEnabled: boolean;
  onCancel: () => void;
  onContract: () => void;
  onEmail: () => void;
}) {
  const note = sameClientReason || emailReason;
  return (
    <div
      className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl bg-[#3D9BEB] px-3 py-2 text-white shadow-sm"
      data-testid="invoice-contract-bar"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white">{selectedCount} selected</p>
        {note && <p className="break-words text-xs font-medium text-amber-100" data-testid="same-client-warning">{note}</p>}
      </div>
      <div className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
        <Button type="button" size="sm" variant="ghost" className="min-h-11 text-white hover:bg-white/15 hover:text-white" onClick={onCancel}>Cancel</Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="min-h-11 border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white"
          disabled={!contractEnabled}
          onClick={onContract}
          data-testid="invoice-create-contract"
        >
          Create service contract
        </Button>
        <Button
          type="button"
          size="sm"
          className="min-h-11 bg-[#C2410C] text-white hover:bg-[#9A3412]"
          disabled={!emailEnabled}
          onClick={onEmail}
          data-testid="invoice-email-these"
        >
          <Mail className="mr-1.5 h-4 w-4" /> Email these ({emailCount})
        </Button>
      </div>
    </div>
  );
}
