import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
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
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 bg-muted-foreground/40 rounded-full" />
        </div>
        <ScrollArea className="flex-1 min-h-0">
          <CreateInvoicePage
            agentId={agentId}
            onBack={onClose}
            onSuccess={onClose}
            prefillLead={prefillLead}
          />
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};

export default CreateInvoiceDialog;
