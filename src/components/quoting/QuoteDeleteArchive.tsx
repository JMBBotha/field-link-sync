import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Archive, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/useRole";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { RowMenuItem } from "@/components/shared/RowMenu";
import {
  type ArchivableQuote, type DeleteCheck, confirmMatches, confirmWord, deleteArchiveMenu, deletionLines, reasonOk,
} from "@/lib/quoteDeleteArchive";

type Open =
  | { kind: "loading"; quote: ArchivableQuote }
  | { kind: "delete"; quote: ArchivableQuote; check: DeleteCheck }
  | { kind: "archive"; quote: ArchivableQuote; reasons?: string[] }
  | null;

const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args);
const label = (q: ArchivableQuote) => q.quote_number || "this quote";

/** Admin-only ⋯ menu entries + dialogs for hard delete / archive / unarchive. Render `dialogs` once per screen. */
export function useQuoteDeleteArchive(opts: { onDeleted?: (id: string) => void; onChanged?: () => void } = {}) {
  const { isAdmin } = useRole();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState<Open>(null);
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [photos, setPhotos] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    for (const k of ["quotes", "admin-quotes", "customer-quotes", "customer-invoices", "quote-document", "dashboard", "pipeline"]) qc.invalidateQueries({ queryKey: [k] });
    opts.onChanged?.();
  };
  const reset = (next: Open) => { setReason(""); setTyped(""); setPhotos(false); setOpen(next); };
  const fail = (title: string, e: any) => toast({ title, description: e?.message || String(e), variant: "destructive" });

  const startDelete = async (q: ArchivableQuote) => {
    reset({ kind: "loading", quote: q });
    const { data, error } = await rpc("quote_delete_check", { p_quote: q.id });
    if (error) { setOpen(null); fail("Could not check this quote", error); return; }
    const check = data as DeleteCheck;
    if (check.can_delete) setOpen({ kind: "delete", quote: q, check });
    else setOpen({ kind: "archive", quote: q, reasons: check.reasons });
  };

  const unarchive = async (q: ArchivableQuote, silent = false) => {
    const { error } = await rpc("quote_unarchive", { p_quote: q.id });
    if (error) { fail("Could not unarchive", error); return; }
    refresh();
    if (!silent) toast({ title: `${label(q)} unarchived`, description: "It shows in lists and follow-ups again." });
  };

  const doArchive = async () => {
    if (open?.kind !== "archive") return;
    const q = open.quote;
    setBusy(true);
    const { error } = await rpc("quote_archive", { p_quote: q.id, p_reason: reason.trim() });
    setBusy(false);
    if (error) { fail("Could not archive", error); return; }
    setOpen(null);
    refresh();
    toast({
      title: `${label(q)} archived`,
      description: "Hidden from lists, the dashboard and follow-ups. Invoices and payments are kept.",
      action: <ToastAction altText="Undo archive" onClick={() => void unarchive(q, false)}>Undo</ToastAction>,
    });
  };

  const doDelete = async () => {
    if (open?.kind !== "delete") return;
    const q = open.quote;
    setBusy(true);
    const { data, error } = await rpc("quote_delete", { p_quote: q.id, p_reason: reason.trim(), p_delete_photos: photos });
    if (error) { setBusy(false); fail("Could not delete", error); return; }
    // Files go only after the database delete committed. A failed file removal leaves an orphan file, never a broken quote.
    const storage = (data?.storage || {}) as Record<string, string[]>;
    let fileErr = 0;
    for (const [bucket, paths] of Object.entries(storage)) {
      const list = (paths || []).filter(Boolean);
      if (!list.length) continue;
      const { error: se } = await supabase.storage.from(bucket).remove(list);
      if (se) fileErr += list.length;
    }
    setBusy(false);
    setOpen(null);
    refresh();
    toast({
      title: `${label(q)} deleted`,
      description: fileErr ? `${fileErr} stored file(s) could not be removed; the quote itself is gone.` : "The quote and everything listed were removed.",
    });
    opts.onDeleted?.(q.id);
  };

  const itemsFor = (q: ArchivableQuote): RowMenuItem[] => {
    const m = deleteArchiveMenu(q, isAdmin);
    return [
      { label: "Archive quote…", hidden: !m.archive, separatorBefore: true, onSelect: () => reset({ kind: "archive", quote: q }) },
      { label: "Delete quote…", hidden: !m.del, destructive: true, onSelect: () => void startDelete(q) },
      { label: "Unarchive quote", hidden: !m.unarchive, separatorBefore: true, onSelect: () => void unarchive(q) },
    ];
  };

  const lines = open?.kind === "delete" ? deletionLines(open.check.counts) : [];
  const word = open && open.kind !== "loading" ? confirmWord(open.quote) : "";
  const canDelete = open?.kind === "delete" && reasonOk(reason) && confirmMatches(typed, open.quote) && !busy;

  const dialogs = (
    <>
      <Dialog open={open?.kind === "loading"} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Checking {open ? label(open.quote) : ""}…</DialogTitle></DialogHeader>
          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
        </DialogContent>
      </Dialog>

      <Dialog open={open?.kind === "delete"} onOpenChange={(o) => !o && !busy && setOpen(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md" data-testid="quote-delete-dialog">
          <DialogHeader>
            <DialogTitle>Delete {open?.kind === "delete" ? label(open.quote) : ""} permanently?</DialogTitle>
            <DialogDescription>This cannot be undone. A full copy is kept in the audit log.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div>
              <p className="font-medium">This removes:</p>
              <ul className="mt-1 list-disc pl-5 text-muted-foreground" data-testid="delete-lines">
                <li>the quote</li>
                {lines.map((l) => <li key={l}>{l}</li>)}
              </ul>
              <p className="mt-1 text-xs text-muted-foreground">The client record stays.</p>
            </div>
            {open?.kind === "delete" && open.check.photos_optional && (
              <label className="flex items-start gap-2 rounded-md border p-2">
                <Checkbox checked={photos} onCheckedChange={(v) => setPhotos(v === true)} aria-label="Also delete visit photos" />
                <span>Also delete the {open.check.counts.visit_photos} visit photo{open.check.counts.visit_photos === 1 ? "" : "s"} (the visit has no other quote)</span>
              </label>
            )}
            <div className="space-y-1">
              <Label htmlFor="qd-reason">Reason</Label>
              <Textarea id="qd-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Test quote / created by mistake" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="qd-confirm">Type <span className="font-mono font-semibold">{word}</span> to confirm</Label>
              <Input id="qd-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setOpen(null)}>Cancel</Button>
            <Button variant="destructive" disabled={!canDelete} onClick={() => void doDelete()}>
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open?.kind === "archive"} onOpenChange={(o) => !o && !busy && setOpen(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md" data-testid="quote-archive-dialog">
          <DialogHeader>
            <DialogTitle>Archive {open?.kind === "archive" ? label(open.quote) : ""}?</DialogTitle>
            <DialogDescription>
              Hidden from quote lists, the dashboard, follow-ups and nudges. Nothing is deleted: invoices, payments and jobs stay,
              and the quote still opens by its link. You can unarchive it.
            </DialogDescription>
          </DialogHeader>
          {open?.kind === "archive" && !!open.reasons?.length && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900" data-testid="archive-only-reasons">
              <p className="font-medium">This quote can only be archived, not deleted:</p>
              <ul className="mt-1 list-disc pl-5">{open.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
            </div>
          )}
          <div className="space-y-1 text-sm">
            <Label htmlFor="qa-reason">Reason</Label>
            <Textarea id="qa-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Client went elsewhere" />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setOpen(null)}>Cancel</Button>
            <Button disabled={!reasonOk(reason) || busy} onClick={() => void doArchive()}>
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  return { itemsFor, dialogs, unarchive, isAdmin };
}

/** "Archived" banner on the quote page (direct link still works). */
export function ArchivedQuoteBanner({ quote, onUnarchive }: {
  quote: { archived_at?: string | null; archive_reason?: string | null }; onUnarchive?: () => void;
}) {
  if (!quote.archived_at) return null;
  return (
    <div role="status" data-testid="archived-banner" className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 print:hidden">
      <Archive className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 break-words">
        <strong>Archived</strong> {format(new Date(quote.archived_at), "dd MMM yyyy")}
        {quote.archive_reason ? ` · ${quote.archive_reason}` : ""}. Hidden from lists and follow-ups.
      </span>
      {onUnarchive && <Button size="sm" variant="outline" className="h-7" onClick={onUnarchive}>Unarchive</Button>}
    </div>
  );
}
