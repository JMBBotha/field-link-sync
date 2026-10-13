// Client self-adjusting quote (Johan 2026-10-13): remove units, add units from the catalogue, change quantities.
// Every unit price already includes installation, so the total recalculates live. Saved as "revised by client";
// the original quote stays live until management approves. Prices are always recomputed by the database.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Minus, Plus, Trash2, SlidersHorizontal } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Line = { key: string; item_id?: string | null; product_id?: string | null; name: string; brand?: string | null; btu?: number | null; area_name?: string | null; quantity: number; unit_price: number; source: "original" | "added" };
type Cat = { product_id: string; name: string; brand?: string | null; btu?: number | null; category?: string | null; unit_price: number };
type AdjustData = {
  lines: any[]; catalogue: Cat[]; discount_pct: number; discount_fixed: number; vat_rate: number; original_total: number;
  pending: { id: string; total: number; created_at: string } | null;
  last_decision: { status: string; decided_at: string } | null;
};

export const fmtZAR = (n: number) => new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n || 0);

export function computeRevisionTotals(lines: { quantity: number; unit_price: number }[], d: { discount_pct: number; discount_fixed: number; vat_rate: number }) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const sub = lines.reduce((s, l) => s + r2(l.quantity * l.unit_price), 0);
  const disc = Math.min(sub, r2(sub * (Number(d.discount_pct) || 0) / 100 + (Number(d.discount_fixed) || 0)));
  const vat = r2((sub - disc) * (Number(d.vat_rate) || 0));
  return { subtotal: r2(sub), discount: disc, vat, total: r2(sub - disc + vat) };
}

export default function ClientAdjustQuote({ token, defaultName, onEditingChange }: { token: string; defaultName?: string; onEditingChange?: (editing: boolean) => void }) {
  const { toast } = useToast();
  const [data, setData] = useState<AdjustData | null>(null);
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data: d } = await supabase.rpc("public_quote_adjust_data" as never, { p_token: token } as never);
    const v = d as unknown as AdjustData | null;
    setData(v);
    if (v) setLines((v.lines || []).map((l: any) => ({ key: `i-${l.item_id}`, item_id: l.item_id, product_id: l.product_id, name: l.name, brand: l.brand, btu: l.btu, area_name: l.area_name, quantity: Number(l.quantity) || 1, unit_price: Number(l.unit_price) || 0, source: "original" })));
  };
  useEffect(() => { load(); }, [token]);
  useEffect(() => { onEditingChange?.(open); }, [open]);

  const totals = useMemo(() => (data ? computeRevisionTotals(lines, data) : null), [lines, data]);
  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!data || q.length < 2) return [];
    return data.catalogue.filter((c) => `${c.brand || ""} ${c.name} ${c.btu || ""} ${c.category || ""}`.toLowerCase().includes(q)).slice(0, 8);
  }, [search, data]);

  if (!data || !data.lines?.length) return null;

  const setQty = (key: string, q: number) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, quantity: Math.max(1, Math.min(50, q)) } : l)));
  const remove = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));
  const add = (c: Cat) => {
    setLines((ls) => {
      const ex = ls.find((l) => l.source === "added" && l.product_id === c.product_id);
      if (ex) return ls.map((l) => (l === ex ? { ...l, quantity: Math.min(50, l.quantity + 1) } : l));
      return [...ls, { key: `p-${c.product_id}`, product_id: c.product_id, name: c.name, brand: c.brand, btu: c.btu, quantity: 1, unit_price: Number(c.unit_price) || 0, source: "added" }];
    });
    setSearch("");
  };

  const submit = async () => {
    if (!lines.length) { toast({ title: "Keep at least one unit", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const payload = lines.map((l) => (l.source === "original" ? { item_id: l.item_id, quantity: l.quantity } : { product_id: l.product_id, quantity: l.quantity }));
      const { error } = await supabase.rpc("submit_client_revision" as never, { p_token: token, p_lines: payload, p_note: note.trim() || null, p_name: defaultName || null } as never);
      if (error) throw error;
      toast({ title: "Sent for approval", description: "We'll confirm your changes shortly. Your original quote stays valid until then." });
      setOpen(false); setNote("");
      await load();
    } catch (e: any) {
      toast({ title: "Could not send your changes", description: e?.message || "Please try again.", variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <Card className="rounded-2xl shadow-md border-0 print:hidden" data-client-adjust>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold text-foreground flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-[#0B4FA8]" /> Adjust your quote</h3>
            <p className="text-xs text-muted-foreground">Remove or add units and change quantities. Prices include installation.</p>
          </div>
          {!open && <Button size="sm" variant="outline" className="text-[#0B4FA8]" onClick={() => setOpen(true)}>Adjust</Button>}
        </div>
        {data.pending && (
          <div className="rounded-lg bg-amber-50 text-amber-800 text-sm p-3">
            Your revised quote ({fmtZAR(Number(data.pending.total))}) is waiting for approval. Your original quote stays valid until then.
          </div>
        )}
        {!data.pending && data.last_decision?.status === "rejected" && (
          <div className="rounded-lg bg-slate-50 text-slate-700 text-sm p-3">Your last changes could not be approved. Your consultant will be in touch.</div>
        )}
        {open && (
          <div className="space-y-3">
            {lines.map((l) => (
              <div key={l.key} className="flex items-center gap-2 border rounded-xl p-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium break-words">{l.name}</div>
                  <div className="text-xs text-muted-foreground">{[l.area_name, l.source === "added" ? "Added" : null, `${fmtZAR(l.unit_price)} each, installed`].filter(Boolean).join(" · ")}</div>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Fewer" onClick={() => setQty(l.key, l.quantity - 1)} disabled={l.quantity <= 1}><Minus className="h-3.5 w-3.5" /></Button>
                  <span className="w-6 text-center text-sm font-semibold">{l.quantity}</span>
                  <Button size="icon" variant="outline" className="h-8 w-8" aria-label="More" onClick={() => setQty(l.key, l.quantity + 1)}><Plus className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" aria-label="Remove" onClick={() => remove(l.key)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
            <div className="relative">
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Add a unit: search e.g. 12K, Samsung, cassette" className="rounded-xl" />
              {results.length > 0 && (
                <div className="absolute z-30 mt-1 w-full rounded-xl border bg-white shadow-lg max-h-72 overflow-auto">
                  {results.map((c) => (
                    <button key={c.product_id} type="button" onClick={() => add(c)} className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm flex justify-between gap-2">
                      <span className="truncate">{c.name}</span><span className="text-[#0B4FA8] font-semibold whitespace-nowrap">{fmtZAR(c.unit_price)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 1000))} placeholder="Anything we should know? (optional)" className="rounded-xl min-h-[64px]" />
            {totals && (
              <div className="rounded-xl bg-blue-50 p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Original total</span><span>{fmtZAR(Number(data.original_total))}</span></div>
                {totals.discount > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span>-{fmtZAR(totals.discount)}</span></div>}
                <div className="flex justify-between"><span className="text-muted-foreground">VAT</span><span>{fmtZAR(totals.vat)}</span></div>
                <div className="flex justify-between font-bold text-[#0B4FA8] text-base"><span>New total incl. VAT</span><span>{fmtZAR(totals.total)}</span></div>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setOpen(false); load(); }} disabled={busy}>Cancel</Button>
              <Button onClick={submit} disabled={busy || !lines.length} className="bg-[#0B4FA8] hover:bg-[#0B4FA8]/90 text-white">
                {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Send for approval
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
