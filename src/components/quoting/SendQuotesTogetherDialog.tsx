import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Mail } from "lucide-react";
import { getPublicAppOrigin } from "@/lib/publicAppUrl";
import { sendTogetherBlock } from "@/lib/quoteBundle";

type Row = { id: string; quote_number: string | null; status: string; customer_id: string | null; customer_name: string | null; total: number | null; valid_until: string | null; client_summary: string | null; auto_summary: string | null };
const fmtR = (n: number) => new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

/** One email, one "View all quotes" button, for several non-draft quotes of the same client. */
export default function SendQuotesTogetherDialog({ open, onOpenChange, quoteIds, onSent }: { open: boolean; onOpenChange: (v: boolean) => void; quoteIds: string[]; onSent?: () => void }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [desc, setDesc] = useState<Record<string, string>>({});
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || quoteIds.length === 0) return;
    let live = true;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase.rpc("quote_bundle_preview" as never, { p_quote_ids: quoteIds } as never);
      if (!live) return;
      const list = ((data as unknown as Row[]) || []);
      setRows(list);
      setDesc(Object.fromEntries(list.map((r) => [r.id, r.client_summary || r.auto_summary || ""])));
      const cid = list[0]?.customer_id;
      if (cid) {
        const { data: c } = await supabase.from("customers").select("email").eq("id", cid).maybeSingle();
        if (live) setEmail((c as { email?: string } | null)?.email || "");
      }
      if (error) toast({ title: "Could not load quotes", description: error.message, variant: "destructive" });
      setLoading(false);
    })();
    return () => { live = false; };
  }, [open, quoteIds.join(",")]);

  const block = rows.length ? sendTogetherBlock(rows) : null;

  // Duplicate-send guard (17 Oct 2026): two rapid taps fire once; one Resend Idempotency-Key per press.
  const sendingRef = useRef(false);
  const send = async () => {
    if (sendingRef.current) return;
    if (!email.trim()) { toast({ title: "Email required", description: "Add the client's email address.", variant: "destructive" }); return; }
    sendingRef.current = true;
    setBusy(true);
    try {
      // Only store a description when staff changed it from the auto text.
      const summaries = Object.fromEntries(rows.map((r) => {
        const v = (desc[r.id] || "").trim();
        return [r.id, v && v !== (r.auto_summary || "") ? v : ""];
      }));
      const { data: b, error: e1 } = await supabase.rpc("create_quote_bundle" as never, { p_quote_ids: rows.map((r) => r.id), p_summaries: summaries } as never);
      if (e1) throw new Error(e1.message);
      const token = (b as unknown as { token: string }).token;
      const { data, error } = await supabase.functions.invoke("send-quote-email", { body: { bundleToken: token, to: email.trim(), appOrigin: getPublicAppOrigin(), sendId: crypto.randomUUID() } });
      const p = data as { success?: boolean; skipped?: boolean; reason?: string; error?: string; details?: { message?: string } } | null;
      if (error || !p?.success) throw new Error(p?.reason || p?.details?.message || p?.error || error?.message || "Send failed");
      toast({ title: `${rows.length} quotes sent together`, description: `One email with "View all quotes" went to ${email.trim()}.` });
      onSent?.();
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Not sent", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally { sendingRef.current = false; setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg w-[calc(100vw-1.5rem)] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send {rows.length || quoteIds.length} quotes together</DialogTitle>
          <DialogDescription className="break-words">One email to {rows[0]?.customer_name || "the client"} with one "View all quotes" button. Each quote can be accepted on its own.</DialogDescription>
        </DialogHeader>
        {loading ? <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div> : (
          <div className="space-y-3">
            {rows.map((r) => (
              <div key={r.id} className="rounded-lg border p-3 space-y-1.5">
                <div className="flex justify-between gap-2 text-sm">
                  <b className="break-all">{r.quote_number || "Quote"}</b>
                  <b className="text-[#0B4FA8] whitespace-nowrap">{fmtR(Number(r.total) || 0)}</b>
                </div>
                <Label className="text-xs text-muted-foreground" htmlFor={`d-${r.id}`}>One-line description (optional)</Label>
                <Textarea id={`d-${r.id}`} rows={2} className="min-h-0 resize-none text-sm" value={desc[r.id] ?? ""} maxLength={200} placeholder="e.g. 2x Samsung 12k midwall (bedrooms)" onChange={(e) => setDesc((d) => ({ ...d, [r.id]: e.target.value }))} />
                {r.auto_summary && (desc[r.id] || "") !== r.auto_summary && (
                  <button type="button" className="text-[11px] text-[#0B4FA8] underline" onClick={() => setDesc((d) => ({ ...d, [r.id]: r.auto_summary || "" }))}>Use auto text</button>
                )}
              </div>
            ))}
            <div className="space-y-1">
              <Label htmlFor="bundle-email">Client email</Label>
              <Input id="bundle-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            {block && <p className="text-sm text-destructive">{block}</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={send} disabled={busy || loading || !!block || rows.length < 2} className="bg-[#F7941D] hover:bg-[#e08310] text-white">
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Mail className="h-4 w-4 mr-2" />} Send together
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
