import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/** A service booking may omit the technician only after this warning is confirmed. */
export default function BookWithoutTechDialog({ open, onOpenChange, onConfirm }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="book-without-tech">
        <DialogHeader>
          <DialogTitle>Book without a technician?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-foreground">
          This service visit will be booked with nobody to do the work. It stays on the calendar as <b>No technician</b>, in Needs someone, and on Home.
          Admins and the salesperson are told now, again 48 hours before the visit, and again 24 hours before, until a technician is assigned.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>Go back</Button>
          <Button type="button" className="min-h-11 bg-[#C2410C] text-white hover:bg-[#9A3412]" data-testid="confirm-book-without-tech" onClick={() => { onOpenChange(false); onConfirm(); }}>
            Book without technician
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
