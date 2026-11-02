import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Trash button (44px) + "Delete this photo?" confirm. Own overlay at z-[100] so it sits above the
 * full-screen PhotoViewer (z-[90]). onConfirm throws to keep the box open and show the reason.
 */
export default function PhotoDeleteButton({ onConfirm, testId = "photo-delete", variant = "viewer", className = "" }: {
  onConfirm: () => Promise<void>; testId?: string; variant?: "viewer" | "thumb"; className?: string;
}) {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setErr(null);
    try { await onConfirm(); setAsk(false); } catch (e: any) { setErr(e?.message || "Couldn't delete the photo."); } finally { setBusy(false); }
  };
  return (
    <>
      {variant === "viewer" ? (
        <Button type="button" variant="destructive" className={`min-h-[44px] ${className}`} onClick={(e) => { e.stopPropagation(); setAsk(true); }} data-testid={testId} aria-label="Delete photo">
          <Trash2 className="h-4 w-4 mr-1" />Delete
        </Button>
      ) : (
        <button type="button" onClick={(e) => { e.stopPropagation(); setAsk(true); }} data-testid={testId} aria-label="Delete photo"
          className={`flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white hover:bg-destructive ${className}`}>
          <Trash2 className="h-5 w-5" />
        </button>
      )}
      {ask && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-4 sm:items-center" role="alertdialog" aria-modal="true" aria-labelledby="photo-del-t" data-testid="photo-delete-confirm"
          onClick={(e) => { e.stopPropagation(); if (!busy) setAsk(false); }}>
          <div className="w-full max-w-sm rounded-2xl bg-background p-5 text-foreground shadow-xl space-y-3" onClick={(e) => e.stopPropagation()}>
            <h2 id="photo-del-t" className="text-lg font-bold">Delete this photo?</h2>
            <p className="text-sm text-muted-foreground">It's removed from the record and from storage for everyone. This can't be undone.</p>
            {err && <p className="text-sm text-destructive" role="alert">{err}</p>}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <Button type="button" variant="outline" className="min-h-[44px]" disabled={busy} onClick={() => setAsk(false)}>Cancel</Button>
              <Button type="button" variant="destructive" className="min-h-[44px]" disabled={busy} onClick={go} data-testid={`${testId}-yes`}>
                {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
