import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/** Asked when a unit with linked install lines is removed. Default = remove all. */
export default function RemoveUnitDialog({
  open, linkedCount, onYes, onNo, onCancel,
}: { open: boolean; linkedCount: number; onYes: () => void; onNo: () => void; onCancel: () => void }) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove its install materials too?</AlertDialogTitle>
          <AlertDialogDescription>
            This unit has {linkedCount} linked install line{linkedCount === 1 ? "" : "s"}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <Button type="button" variant="outline" onClick={onNo}>No, keep materials</Button>
          <Button type="button" autoFocus onClick={onYes}>Yes, remove all</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
