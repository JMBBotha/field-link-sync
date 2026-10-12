import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { dupHeadline, pickPrimary, whenText, type ClientBooking } from "@/lib/sameClient";

/** "This client already has a booking on <date> with <tech>: replace it, add as a second visit, or cancel". Replace is the default. */
export default function SameClientDialog({ rows, busy, onReplace, onSecondVisit, onCancel }: {
  rows: ClientBooking[] | null;
  busy?: boolean;
  onReplace: (b: ClientBooking) => void;
  onSecondVisit: (b: ClientBooking) => void;
  onCancel: () => void;
}) {
  const primary = pickPrimary(rows);
  const others = (rows ?? []).filter((r) => r !== primary);
  return (
    <AlertDialog open={!!primary} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <AlertDialogContent data-testid="same-client-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{primary?.match === "strong" ? "Same client already booked" : "Possibly the same client"}</AlertDialogTitle>
          <AlertDialogDescription>
            {primary ? dupHeadline(primary) : ""}. Replace it with this new date and time, add this as a second visit, or cancel.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {others.length > 0 && (
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {others.slice(0, 4).map((r) => (
              <li key={r.lead_id}>Also open: {whenText(r.scheduled_date, r.scheduled_time)}{r.tech_name ? ` · ${r.tech_name}` : ""} ({r.status})</li>
            ))}
          </ul>
        )}
        <AlertDialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button variant="outline" disabled={busy} onClick={() => primary && onSecondVisit(primary)}>Add as second visit</Button>
          <Button autoFocus disabled={busy} onClick={() => primary && onReplace(primary)}>Replace it</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
