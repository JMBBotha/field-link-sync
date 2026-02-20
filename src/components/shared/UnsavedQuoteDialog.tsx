import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface UnsavedQuoteDialogProps {
  open: boolean;
  onContinue: () => void;
  onSaveForLater: () => void;
  onDiscard: () => void;
}

const UnsavedQuoteDialog = ({
  open,
  onContinue,
  onSaveForLater,
  onDiscard,
}: UnsavedQuoteDialogProps) => (
  <AlertDialog open={open} onOpenChange={(v) => !v && onContinue()}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Unsaved Quote</AlertDialogTitle>
        <AlertDialogDescription>
          You have unsaved changes. What would you like to do?
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter className="flex-col sm:flex-row gap-2">
        <Button variant="outline" onClick={onContinue} className="sm:order-1">
          Continue Editing
        </Button>
        <Button variant="secondary" onClick={onSaveForLater} className="sm:order-2">
          Save for Later
        </Button>
        <Button variant="destructive" onClick={onDiscard} className="sm:order-3">
          Disregard Quote
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

export default UnsavedQuoteDialog;
