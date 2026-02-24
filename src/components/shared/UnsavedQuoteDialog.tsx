import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Save, Send, Trash2, ArrowLeft } from "lucide-react";

interface UnsavedQuoteDialogProps {
  open: boolean;
  onContinue: () => void;
  onSaveForLater: () => void;
  onDiscard: () => void;
  onSendQuote?: () => void;
  onDeleteQuote?: () => void;
  canSave?: boolean;
  canSend?: boolean;
}

const UnsavedQuoteDialog = ({
  open,
  onContinue,
  onSaveForLater,
  onDiscard,
  onSendQuote,
  onDeleteQuote,
  canSave = true,
  canSend = false,
}: UnsavedQuoteDialogProps) => (
  <AlertDialog open={open} onOpenChange={(v) => !v && onContinue()}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
        <AlertDialogDescription>
          This quote has unsaved changes. What would you like to do?
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter className="flex-col sm:grid sm:grid-cols-2 gap-2">
        <Button
          variant="outline"
          onClick={onSaveForLater}
          disabled={!canSave}
          className="sm:order-1 gap-1.5"
          title={!canSave ? "Assign a client to save this quote" : undefined}
        >
          <Save className="h-4 w-4" />
          Save as Draft
        </Button>
        {onSendQuote && (
          <Button
            variant="secondary"
            onClick={onSendQuote}
            disabled={!canSend}
            className="sm:order-2 gap-1.5"
            title={!canSend ? "Assign a client and add items to send" : undefined}
          >
            <Send className="h-4 w-4" />
            Send Quote
          </Button>
        )}
        {onDeleteQuote && (
          <Button
            variant="destructive"
            onClick={onDeleteQuote}
            className="sm:order-3 gap-1.5"
          >
            <Trash2 className="h-4 w-4" />
            Delete Quote
          </Button>
        )}
        <Button variant="ghost" onClick={onContinue} className="sm:order-4 gap-1.5">
          <ArrowLeft className="h-4 w-4" />
          Cancel
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

export default UnsavedQuoteDialog;
