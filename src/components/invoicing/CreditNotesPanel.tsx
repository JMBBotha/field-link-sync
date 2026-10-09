import { useState } from "react";
import { FileMinus2, Loader2, Printer, Ban } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useSalesRep } from "@/hooks/useSalesRep";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatRand } from "@/utils/formatRand";
import { CREDIT_REASONS, reasonLabel, suggestReason, vatFromInclusive, type CreditNoteRow, type CreditReason } from "@/lib/creditNotes";

interface Props {
  invoice: { id: string; invoice_number: string; status: string | null; customer_name: string; customer_address?: string | null; tax_rate: number | null; tax_amount: number | null; grand_total: number | null };
  outstanding: number;
  credits: CreditNoteRow[];
  onChange: () => void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** Simple printable credit note (browser print → PDF). */
function printCreditNote(cn: CreditNoteRow, inv: Props["invoice"]) {
  const w = window.open("", "_blank", "noopener=no,width=820,height=900");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><title>Credit note ${esc(cn.credit_note_number)}</title>
<style>body{font-family:system-ui,sans-serif;color:#1e293b;max-width:720px;margin:40px auto;padding:0 24px}h1{color:#1B3A5C;margin:0}
table{width:100%;border-collapse:collapse;margin-top:24px}td,th{padding:8px;border-bottom:1px solid #e2e8f0;text-align:left}td.r,th.r{text-align:right}
.tot td{font-weight:700;border-top:2px solid #1B3A5C}.muted{color:#64748b;font-size:13px}</style></head><body>
<h1>Credit note ${esc(cn.credit_note_number)}${cn.status === "void" ? " (VOID)" : ""}</h1>
<p class="muted">Date ${esc(cn.issue_date)} · Against invoice ${esc(inv.invoice_number)}</p>
<p><strong>${esc(inv.customer_name || "")}</strong><br/>${esc(inv.customer_address || "")}</p>
<table><tr><th>Description</th><th class="r">Amount</th></tr>
<tr><td>${esc(reasonLabel(cn.reason))}${cn.description ? ` — ${esc(cn.description)}` : ""}</td><td class="r">${formatRand(Number(cn.subtotal))}</td></tr>
<tr><td>VAT (${Number(cn.tax_rate)}%)</td><td class="r">${formatRand(Number(cn.tax_amount))}</td></tr>
<tr class="tot"><td>Total credited</td><td class="r">${formatRand(Number(cn.total))}</td></tr></table>
<p class="muted">This credit note reduces the amount due on invoice ${esc(inv.invoice_number)}.</p>
<script>setTimeout(()=>window.print(),300)</script></body></html>`);
  w.document.close();
}

export default function CreditNotesPanel({ invoice, outstanding, credits, onChange }: Props) {
  const { toast } = useToast();
  const { isSalesRep } = useSalesRep();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState<CreditReason>("write_off");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [voiding, setVoiding] = useState<CreditNoteRow | null>(null);
  const [voidReason, setVoidReason] = useState("");

  const canIssue = !isSalesRep && !["draft", "void", "cancelled"].includes(invoice.status ?? "draft") && outstanding > 0;
  const rate = Number(invoice.tax_amount) > 0 ? (Number(invoice.tax_rate) <= 1 ? Number(invoice.tax_rate) * 100 : Number(invoice.tax_rate) || 15) : 0;
  const amt = Number(amount) || 0;

  const openDialog = (full: boolean) => {
    setAmount(full ? outstanding.toFixed(2) : "");
    setReason(full ? suggestReason(outstanding) : "deduction");
    setDescription("");
    setOpen(true);
  };

  const issue = async () => {
    setBusy(true);
    const { error } = await (supabase as any).rpc("issue_credit_note", { p_invoice_id: invoice.id, p_amount: amt, p_reason: reason, p_description: description || null });
    setBusy(false);
    if (error) { toast({ title: "Credit note not issued", description: error.message, variant: "destructive" }); return; }
    setOpen(false);
    toast({ title: "Credit note issued", description: `${formatRand(amt)} credited (VAT ${formatRand(vatFromInclusive(amt, rate))}). Nothing was sent to the client.` });
    onChange();
  };

  const doVoid = async () => {
    if (!voiding) return;
    setBusy(true);
    const { error } = await (supabase as any).rpc("void_credit_note", { p_id: voiding.id, p_reason: voidReason });
    setBusy(false);
    if (error) { toast({ title: "Could not void", description: error.message, variant: "destructive" }); return; }
    setVoiding(null); setVoidReason("");
    toast({ title: `Credit note ${voiding.credit_note_number} voided` });
    onChange();
  };

  if (!credits.length && !canIssue) return null;
  return (
    <div data-testid="credit-notes" className="space-y-2 rounded-lg border border-border bg-card p-3 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold"><FileMinus2 className="h-4 w-4 text-muted-foreground" /> Credit notes &amp; write-offs</p>
        {canIssue && (
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" onClick={() => openDialog(false)}>New credit note</Button>
            <Button size="sm" variant="outline" onClick={() => openDialog(true)} data-testid="write-off-balance">Write off {formatRand(outstanding)}</Button>
          </div>
        )}
      </div>
      {credits.length === 0 ? (
        <p className="text-xs text-muted-foreground">None. A credit note lowers what the client owes and the VAT on this invoice.</p>
      ) : (
        <ul className="divide-y text-sm">
          {credits.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span className={c.status === "void" ? "text-muted-foreground line-through" : ""}>
                <span className="font-medium">{c.credit_note_number}</span> · {c.issue_date} · {reasonLabel(c.reason)}
                {c.description ? <span className="text-muted-foreground"> · {c.description}</span> : null}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="tabular-nums">−{formatRand(Number(c.total))}</span>
                <span className="text-xs text-muted-foreground">VAT {formatRand(Number(c.tax_amount))}</span>
                {c.status === "void" && <Badge variant="secondary" title={c.void_reason || undefined}>void</Badge>}
                <Button size="icon" variant="ghost" className="h-7 w-7" title="Print / PDF" onClick={() => printCreditNote(c, invoice)}><Printer className="h-3.5 w-3.5" /></Button>
                {!isSalesRep && c.status !== "void" && (
                  <Button size="icon" variant="ghost" className="h-7 w-7" title="Void" onClick={() => { setVoiding(c); setVoidReason(""); }}><Ban className="h-3.5 w-3.5" /></Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Credit note on {invoice.invoice_number}</DialogTitle>
            <DialogDescription>Outstanding {formatRand(outstanding)}. Amounts include VAT; nothing is sent to the client.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="cn-amount">Amount (incl. VAT)</Label>
              <Input id="cn-amount" type="number" inputMode="decimal" min="0.01" step="0.01" max={outstanding} value={amount} onChange={(e) => setAmount(e.target.value)} />
              <p className="text-xs text-muted-foreground">VAT reduced by {formatRand(vatFromInclusive(amt, rate))}{rate ? ` (${rate}%)` : " (no VAT on this invoice)"}.</p>
            </div>
            <div className="space-y-1">
              <Label>Reason</Label>
              <Select value={reason} onValueChange={(v) => setReason(v as CreditReason)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CREDIT_REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="cn-desc">Note (on the credit note)</Label>
              <Textarea id="cn-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Client deducted R50 for damaged trim" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={issue} disabled={busy || amt <= 0 || amt > outstanding + 0.005}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Issue credit note</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!voiding} onOpenChange={(o) => { if (!o) setVoiding(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Void {voiding?.credit_note_number}?</DialogTitle>
            <DialogDescription>The credit note is kept (marked void) and the amount becomes owing again.</DialogDescription>
          </DialogHeader>
          <Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Reason (required)" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoiding(null)}>Cancel</Button>
            <Button variant="destructive" onClick={doVoid} disabled={busy || !voidReason.trim()}>Void</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
