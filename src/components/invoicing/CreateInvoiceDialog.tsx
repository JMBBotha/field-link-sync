import { Sheet, SheetContent } from "@/components/ui/sheet";
import { X } from "lucide-react";
import CreateInvoicePage from "./CreateInvoicePage";

interface CreateInvoiceDialogProps {
  open: boolean;
  onClose: () => void;
  agentId: string;
  prefillLead: {
    id: string;
    customer_name: string;
    customer_phone: string;
    customer_address: string;
    customer_id?: string | null;
    service_type?: string;
  };
}

const CreateInvoiceDialog = ({ open, onClose, agentId, prefillLead }: CreateInvoiceDialogProps) => {
  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <SheetContent side="bottom" className="max-h-[95vh] flex flex-col p-0 border-border/50 shadow-2xl" hideCloseButton>
        <div className="flex items-center justify-between px-4 pt-3 pb-1 shrink-0">
          <div className="flex-1 flex justify-center">
            <div className="w-10 h-1 bg-muted-foreground/40 rounded-full" />
          </div>
          <button
            onClick={onClose}
            className="absolute top-3 right-3 h-8 w-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5 stroke-[3]" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
          <CreateInvoicePage
            agentId={agentId}
            onBack={onClose}
            onSuccess={onClose}
            prefillLead={prefillLead}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default CreateInvoiceDialog;
