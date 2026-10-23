import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FilePlus2, Lock, Loader2, Unlock, UserPen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import type { QuoteLockState } from "@/hooks/useQuoteLock";

/**
 * "Locked: accepted" / "Locked: invoiced" banner + admin actions (Johan 2026-10-23).
 * Rules (enforced on the server by migration 0029, this is only the face of it):
 * - Draft / sent: rep and admins edit freely (no banner).
 * - Accepted: read-only for reps, techs and office. An admin can "Unlock to edit" (reason, logged) or "Create variation".
 * - Invoiced / paid: read-only for everyone. Changes go on a variation (extra work) or a credit note (less work).
 * - Admin "Edit client details": VAT / billing name / address, logged; issued invoices are never silently changed.
 */
const fmt = (s?: string | null) => (s ? new Date(s).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" }) : "");
const money = (n?: number | null) => `R${Number(n || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function lockHeadline(lock: QuoteLockState): string | null {
  if (lock.state === "invoiced") return `Locked: invoiced (${lock.invoice_number ?? "invoice"} ${lock.invoice_status ?? ""})`.replace(" )", ")");
  if (lock.state === "accepted_locked") return "Locked: accepted";
  if (lock.state === "accepted_unlocked") return lock.can_edit ? "Unlocked for editing (admin)" : "Locked: accepted";
  return null;
}

export function lockExplainer(lock: QuoteLockState): string {
  if (lock.state === "invoiced") return "The invoice has gone out, so this quote can't change. Extra work goes on a variation; less work on a credit note.";
  if (lock.state === "accepted_unlocked" && lock.can_edit) return "Totals will change on the quote. Lock it again when you're done. The deposit invoice is not updated automatically.";
  return lock.is_admin
    ? "The client accepted this quote. Unlock it with a reason (logged) or create a variation for extra work."
    : "The client accepted this quote. Only an admin can change it or create a variation.";
}

export function ReasonDialog({ open, onOpenChange, title, description, label, confirmLabel, onConfirm, busy, testId }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description: string; label: string; confirmLabel: string;
  onConfirm: (reason: string) => void; busy?: boolean; testId?: string;
}) {
  const [reason, setReason] = useState("");
  useEffect(() => { if (open) setReason(""); }, [open]);
  const ok = reason.trim().length >= 3;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid={testId}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={`${testId}-reason`}>{label}</Label>
          <Textarea id={`${testId}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Saved in the log with your name" autoFocus />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => onConfirm(reason.trim())} disabled={!ok || busy}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const CLIENT_FIELDS: { key: string; label: string; full?: boolean }[] = [
  { key: "name", label: "Client name" },
  { key: "company_name", label: "Company (billing name)" },
  { key: "vat_number", label: "VAT number" },
  { key: "primary_address_line1", label: "Address line 1", full: true },
  { key: "primary_address_line2", label: "Address line 2", full: true },
  { key: "city", label: "City" },
  { key: "postal_code", label: "Postal code" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
];

export function ClientDetailsDialog({ open, onOpenChange, quoteId, lock, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; quoteId: string; lock: QuoteLockState; onDone: () => void;
}) {
  const { toast } = useToast();
  const [orig, setOrig] = useState<Record<string, string>>({});
  const [vals, setVals] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    setReason(""); setLoading(true);
    void (async () => {
      const { data } = await supabase.from("quotes")
        .select("customer_id, customers(name, company_name, vat_number, primary_address_line1, primary_address_line2, city, postal_code, email, phone)")
        .eq("id", quoteId).maybeSingle();
      const c: any = (data as any)?.customers || {};
      const o = Object.fromEntries(CLIENT_FIELDS.map((f) => [f.key, c[f.key] ?? ""]));
      setOrig(o); setVals(o); setLoading(false);
    })();
  }, [open, quoteId]);
  const changes = Object.fromEntries(CLIENT_FIELDS.filter((f) => (vals[f.key] ?? "") !== (orig[f.key] ?? "")).map((f) => [f.key, vals[f.key]]));
  const nChanges = Object.keys(changes).length;
  const save = async () => {
    setBusy(true);
    const { data, error } = await (supabase.rpc as any)("admin_correct_client_details", { p_quote_id: quoteId, p_changes: changes, p_reason: reason.trim() });
    setBusy(false);
    if (error) { toast({ title: "Couldn't save client details", description: error.message, variant: "destructive" }); return; }
    const issued = ((data as any)?.issued_invoices_unchanged || []) as { invoice_number: string; status: string }[];
    toast({
      title: "Client details corrected (logged)",
      description: issued.length
        ? `${issued.map((i) => `${i.invoice_number} (${i.status})`).join(", ")} already went out and was not changed. Reissue it or use a credit note if the client needs a corrected invoice.`
        : "Draft invoices now show the new details.",
    });
    onOpenChange(false); onDone();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto" data-testid="client-details-dialog">
        <DialogHeader>
          <DialogTitle>Edit client details</DialogTitle>
          <DialogDescription>
            Admin correction, saved in the log with your reason.
            {lock.invoice_number ? ` ${lock.invoice_number} (${lock.invoice_status}) already went out and will not change; draft invoices will.` : " Draft invoices pick up the change."}
          </DialogDescription>
        </DialogHeader>
        {loading ? <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div> : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {CLIENT_FIELDS.map((f) => (
              <div key={f.key} className={`space-y-1 ${f.full ? "sm:col-span-2" : ""}`}>
                <Label htmlFor={`cd-${f.key}`}>{f.label}</Label>
                <Input id={`cd-${f.key}`} value={vals[f.key] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
                  className={(vals[f.key] ?? "") !== (orig[f.key] ?? "") ? "border-amber-400 bg-amber-50" : ""} />
              </div>
            ))}
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="cd-reason">Reason for the correction</Label>
              <Textarea id="cd-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Client sent their VAT certificate" />
            </div>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy || loading || nChanges === 0 || reason.trim().length < 3}>
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Save {nChanges ? `${nChanges} change${nChanges > 1 ? "s" : ""}` : "changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function QuoteAcceptedLock({ quoteId, lock, onChanged, compact }: {
  quoteId: string; lock: QuoteLockState | null; onChanged: () => void; compact?: boolean;
}) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [dlg, setDlg] = useState<null | "unlock" | "variation" | "client">(null);
  const [busy, setBusy] = useState(false);
  if (!lock) return null;
  const headline = lockHeadline(lock);
  const parentLine = lock.parent && lock.variation_kind === "admin_variation" ? lock.parent : null;
  if (!headline && !parentLine && !lock.variations.length) return null;

  const rpc = async (fn: string, args: Record<string, unknown>, okTitle: string) => {
    setBusy(true);
    const { data, error } = await (supabase.rpc as any)(fn, args);
    setBusy(false);
    if (error) { toast({ title: "Couldn't do that", description: error.message, variant: "destructive" }); return null; }
    toast({ title: okTitle });
    return data ?? true;
  };
  const unlock = async (reason: string) => { if (await rpc("unlock_quote", { p_quote_id: quoteId, p_reason: reason }, "Quote unlocked (logged)")) { setDlg(null); onChanged(); } };
  const relock = async () => { if (await rpc("relock_quote", { p_quote_id: quoteId }, "Quote locked again")) onChanged(); };
  const variation = async (reason: string) => {
    const r: any = await rpc("admin_create_quote_variation", { p_quote_id: quoteId, p_reason: reason }, "Variation created");
    if (r?.quote_id) { setDlg(null); onChanged(); navigate(`/admin/estimates/${r.quote_id}`); }
  };

  const tone = lock.state === "invoiced" ? "border-slate-300 bg-slate-100 text-slate-900"
    : lock.can_edit ? "border-amber-300 bg-amber-50 text-amber-950" : "border-emerald-300 bg-emerald-50 text-emerald-950";
  const btn = "h-9 gap-1";
  return (
    <div className="space-y-2 print:hidden" data-html2canvas-ignore data-pdf-hide>
      {headline && (
        <div className={`rounded-xl border px-3 py-2.5 text-sm ${tone}`} data-testid="quote-accepted-lock" data-state={lock.state} role="status">
          <div className="flex items-start gap-2">
            {lock.can_edit ? <Unlock className="mt-0.5 h-4 w-4 shrink-0" /> : <Lock className="mt-0.5 h-4 w-4 shrink-0" />}
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{headline}{lock.locked_at && lock.state !== "accepted_unlocked" ? <span className="font-normal opacity-80"> · {fmt(lock.locked_at)}</span> : null}</div>
              <div className={`${compact ? "text-xs" : "text-[13px]"} opacity-90`}>{lockExplainer(lock)}</div>
              {lock.state === "accepted_unlocked" && lock.last_unlock && (
                <div className="mt-0.5 text-xs opacity-80" data-testid="last-unlock">Unlocked by {lock.last_unlock.by || "admin"} · {fmt(lock.last_unlock.at)} · “{lock.last_unlock.reason}”</div>
              )}
            </div>
          </div>
          {(lock.can_unlock || lock.can_relock || lock.can_variation || lock.can_correct_client) && (
            <div className="mt-2 flex flex-wrap gap-2" data-testid="admin-lock-actions">
              {lock.can_unlock && <Button size="sm" variant="outline" className={`${btn} bg-white`} disabled={busy} onClick={() => setDlg("unlock")}><Unlock className="h-3.5 w-3.5" /> Unlock to edit</Button>}
              {lock.can_relock && <Button size="sm" variant="outline" className={`${btn} bg-white`} disabled={busy} onClick={() => void relock()}><Lock className="h-3.5 w-3.5" /> Lock again</Button>}
              {lock.can_variation && <Button size="sm" className={btn} disabled={busy} onClick={() => setDlg("variation")}><FilePlus2 className="h-3.5 w-3.5" /> Create variation</Button>}
              {lock.can_correct_client && <Button size="sm" variant="outline" className={`${btn} bg-white`} disabled={busy} onClick={() => setDlg("client")}><UserPen className="h-3.5 w-3.5" /> Edit client details</Button>}
            </div>
          )}
        </div>
      )}
      {lock.variations.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm" data-testid="variation-links">
          <span className="font-medium">Variations: </span>
          {lock.variations.map((v, i) => (
            <span key={v.id}>{i > 0 && " · "}<button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => navigate(`/admin/estimates/${v.id}`)}>{v.quote_number}</button> <span className="text-muted-foreground">({v.status}, {money(v.total)})</span></span>
          ))}
        </div>
      )}
      {parentLine && (
        <div className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-950" data-testid="variation-parent">
          Variation to <button type="button" className="font-semibold underline-offset-2 hover:underline" onClick={() => navigate(`/admin/estimates/${parentLine.id}`)}>{parentLine.quote_number}</button>. Only the extra or changed work goes here; it is sent, accepted and invoiced on its own.
        </div>
      )}
      <ReasonDialog open={dlg === "unlock"} onOpenChange={(o) => setDlg(o ? "unlock" : null)} busy={busy} testId="unlock-dialog"
        title="Unlock to edit" label="Why does this accepted quote need to change?"
        description="Only admins can do this. Your reason is saved in the log. Reps stay locked out; lock it again when you're done."
        confirmLabel="Unlock" onConfirm={(r) => void unlock(r)} />
      <ReasonDialog open={dlg === "variation"} onOpenChange={(o) => setDlg(o ? "variation" : null)} busy={busy} testId="variation-dialog"
        title="Create variation" label="What is the variation for?"
        description="Creates a new draft quote linked to this one (same client and site, same areas, no lines). Add only the extra work, then send it for acceptance. The original stays as accepted."
        confirmLabel="Create variation" onConfirm={(r) => void variation(r)} />
      <ClientDetailsDialog open={dlg === "client"} onOpenChange={(o) => setDlg(o ? "client" : null)} quoteId={quoteId} lock={lock} onDone={onChanged} />
    </div>
  );
}
