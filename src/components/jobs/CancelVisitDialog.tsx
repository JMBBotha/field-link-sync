import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { CANCEL_VISIT_REASONS, type CancelVisitReasonId } from "@/lib/cancelVisit";

/** Reason plus an optional note. Confirming does not close the lead or create an invoice. */
export default function CancelVisitDialog({ open, onOpenChange, busy, onConfirm }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy?: boolean;
  onConfirm: (reason: CancelVisitReasonId, note: string) => void;
}) {
  const [reason, setReason] = useState<CancelVisitReasonId | "">("");
  const [note, setNote] = useState("");
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setReason(""); setNote(""); } onOpenChange(o); }}>
      <DialogContent className="max-w-md" data-testid="cancel-visit-dialog">
        <DialogHeader>
          <DialogTitle>Cancel visit</DialogTitle>
          <DialogDescription>
            The lead and any quotes stay open. No call-out fee and no invoice.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2" data-testid="cancel-visit-reasons">
          {CANCEL_VISIT_REASONS.map((r) => (
            <label key={r.id} className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm">
              <input type="radio" name="cancel-visit-reason" value={r.id} checked={reason === r.id} onChange={() => setReason(r.id)} />
              {r.label}
            </label>
          ))}
          <Textarea value={note} maxLength={500} rows={3} placeholder="Note (optional)" aria-label="Cancel note" onChange={(e) => setNote(e.target.value)} />
        </div>
        <DialogFooter>
          <button type="button" className="fl-btn-secondary px-4" onClick={() => onOpenChange(false)} disabled={busy}>Back</button>
          <button
            type="button"
            className="fl-btn-primary px-4"
            data-testid="cancel-visit-confirm"
            disabled={!reason || busy}
            onClick={() => reason && onConfirm(reason, note.trim())}
          >
            {busy ? "Cancelling…" : "Cancel visit"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
