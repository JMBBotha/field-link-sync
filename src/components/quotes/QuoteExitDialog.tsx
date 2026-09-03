import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { UserPlus, Save, X, Trash2 } from "lucide-react";

export interface QuoteExitDialogProps {
  open: boolean;
  hasClient: boolean;
  onAssociateClient: () => void;
  onSaveDraft: () => void;
  onDiscard: () => void;
  onDelete?: () => void;
}

const QuoteExitDialog = ({
  open,
  hasClient,
  onAssociateClient,
  onSaveDraft,
  onDiscard,
  onDelete,
}: QuoteExitDialogProps) => (
  <AlertDialog open={open} onOpenChange={(v) => !v && onDiscard()}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Unsaved Quote</AlertDialogTitle>
        <AlertDialogDescription>
          {hasClient
            ? "This quote has unsaved changes. Save them into this quote or discard them."
            : "This quote has unsaved changes. A client must be associated before saving or sending."}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
        {!hasClient && (
          <Button onClick={onAssociateClient} className="gap-1.5 w-full">
            <UserPlus className="h-4 w-4" />
            Associate Client
          </Button>
        )}


        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="w-full">
                <Button
                  variant="outline"
                  onClick={onSaveDraft}
                  disabled={!hasClient}
                  className="gap-1.5 w-full"
                >
                  <Save className="h-4 w-4" />
                  Save as Draft
                </Button>
              </span>
            </TooltipTrigger>
            {!hasClient && <TooltipContent>Associate a client first</TooltipContent>}
          </Tooltip>
        </TooltipProvider>

        <Button variant="ghost" onClick={onDiscard} className="gap-1.5 w-full">
          <X className="h-4 w-4" />
          Discard Changes
        </Button>

        {onDelete && (
          <Button variant="destructive" onClick={onDelete} className="gap-1.5 w-full">
            <Trash2 className="h-4 w-4" />
            Delete Quote
          </Button>
        )}
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

export default QuoteExitDialog;
