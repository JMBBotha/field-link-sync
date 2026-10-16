// Client "Compare & adjust" (Johan 2026-10-15): each unit carries its own room's installation and extras
// (piping kit, brackets, drain pump, labour...). Clients can compare the same size in other brands and remove
// rooms. Swapping a brand keeps that room's installation. Prices are recomputed by the database on submit;
// the original quote stays live until management approves.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, SlidersHorizontal, Check, Undo2, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export type AdjustAlt = { product_id: string; name: string; brand?: string | null; btu?: number | null; image_url?: string | null; raw_unit: number; unit_price: number };
export type AdjustLine = {
  item_id: string; product_id?: string | null; name: string; brand?: string | null; btu?: number | null;
  area_id?: string | null; area_name?: string | null; image_url?: string | null; quantity: number;
  raw_unit: number; own_extras: number; install_per_unit: number; unit_price: number; alternatives: AdjustAlt[];
};
export type AdjustData = {
  lines: AdjustLine[]; shared_by_area: { area_id: string; amount: number }[]; job_shared: number;
  discount_pct: number; discount_fixed: number; vat_rate: number; original_total: number;
  pending: { id: string; total: number; created_at: string } | null;
  last_decision: { status: string; decided_at: string } | null;
};
/** item_id -> chosen product_id (original product = no swap); missing key = removed. */
export type Choices = Record<string, string | null>;

export const fmtZAR = (n: number) => new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n || 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Same rule the database uses: kept units + their own install lines, shared lines of rooms that keep a unit, job-wide lines. */
export function computeRevisionTotals(d: Pick<AdjustData, "lines" | "shared_by_area" | "job_shared" | "discount_pct" | "discount_fixed" | "vat_rate">, choices: Choices) {
  let sub = 0;
  const keptAreas = new Set<string>();
  for (const l of d.lines) {
    if (!(l.item_id in choices)) continue;
    const pick = choices[l.item_id];
    const alt = pick && pick !== l.product_id ? l.alternatives.find((a) => a.product_id === pick) : null;
    sub += r2((alt ? Number(alt.raw_unit) : Number(l.raw_unit)) * Number(l.quantity)) + Number(l.own_extras || 0);
    if (l.area_id) keptAreas.add(l.area_id);
  }
  if (keptAreas.size || Object.keys(choices).length) {
    for (const a of d.shared_by_area || []) if (keptAreas.has(a.area_id)) sub += Number(a.amount) || 0;
    sub += Number(d.job_shared) || 0;
  }
  sub = r2(sub);
  const disc = Math.min(sub, r2(sub * (Number(d.discount_pct) || 0) / 100 + (Number(d.discount_fixed) || 0)));
  const vat = r2((sub - disc) * (Number(d.vat_rate) || 0));
  return { subtotal: sub, discount: disc, vat, total: r2(sub - disc + vat) };
}

const initialChoices = (d: AdjustData): Choices => Object.fromEntries(d.lines.map((l) => [l.item_id, l.product_id ?? null]));

export default function ClientAdjustQuote({ token, defaultName, onEditingChange, onAlternatives, openSignal = 0 }: { token: string; defaultName?: string; onEditingChange?: (editing: boolean) => void; /** true when any line has another brand to compare */ onAlternatives?: (has: boolean) => void; /** bump to open the compare view from outside (sticky bar) */ openSignal?: number }) {
  const { toast } = useToast();
  const [data, setData] = useState<AdjustData | null>(null);
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<Choices>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data: d } = await supabase.rpc("public_quote_adjust_data" as never, { p_token: token } as never);
    const v = d as unknown as AdjustData | null;
    setData(v);
    if (v?.lines) setChoices(initialChoices(v));
  };
  useEffect(() => { load(); }, [token]);
  useEffect(() => { onEditingChange?.(open); }, [open]);
  useEffect(() => { onAlternatives?.(!!data?.lines?.some((l) => l.alternatives?.length)); }, [data]);
  useEffect(() => { if (openSignal > 0) setOpen(true); }, [openSignal]);

  const totals = useMemo(() => (data ? computeRevisionTotals(data, choices) : null), [choices, data]);
  const changed = useMemo(() => {
    if (!data) return false;
    return data.lines.some((l) => !(l.item_id in choices) || (choices[l.item_id] ?? null) !== (l.product_id ?? null));
  }, [choices, data]);

  if (!data || !data.lines?.length) return null;
  const hasAlternatives = data.lines.some((l) => l.alternatives?.length);
  const keptCount = Object.keys(choices).length;

  const pick = (itemId: string, productId: string | null) => setChoices((c) => ({ ...c, [itemId]: productId }));
  const remove = (itemId: string) => setChoices((c) => { const n = { ...c }; delete n[itemId]; return n; });

  const submit = async () => {
    if (!keptCount) { toast({ title: "Keep at least one unit", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const payload = data.lines.filter((l) => l.item_id in choices).map((l) => ({ item_id: l.item_id, product_id: choices[l.item_id] }));
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
            <h3 className="font-semibold text-foreground flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-[#0B4FA8]" /> {hasAlternatives ? "Compare brands & adjust" : "Adjust your quote"}</h3>
            <p className="text-xs text-muted-foreground">{hasAlternatives ? "See the same size in other brands, or remove a room. " : "Remove a room you don't need. "}Each price includes that room's full installation.</p>
          </div>
          {!open && <Button size="sm" variant="outline" className="text-[#0B4FA8]" onClick={() => setOpen(true)}>{hasAlternatives ? "Compare" : "Adjust"}</Button>}
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
            {data.lines.map((l) => {
              const removed = !(l.item_id in choices);
              const chosen = choices[l.item_id] ?? null;
              const options = [{ product_id: l.product_id ?? null, name: l.name, unit_price: Number(l.unit_price), quoted: true }, ...(l.alternatives || []).map((a) => ({ product_id: a.product_id, name: a.name, unit_price: Number(a.unit_price), quoted: false }))];
              return (
                <div key={l.item_id} className={`border rounded-xl p-3 space-y-2 ${removed ? "opacity-60 bg-muted/40" : ""}`} data-testid="adjust-room">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{l.area_name || "Unit"}{Number(l.quantity) > 1 ? ` · ${l.quantity}×` : ""}</div>
                      <div className="text-xs text-muted-foreground">Installation & extras for this room: {fmtZAR(Number(l.install_per_unit))}{Number(l.quantity) > 1 ? " each" : ""}</div>
                    </div>
                    {removed ? (
                      <Button size="sm" variant="ghost" className="h-8 text-[#0B4FA8]" onClick={() => pick(l.item_id, l.product_id ?? null)}><Undo2 className="h-4 w-4 mr-1" /> Keep</Button>
                    ) : (
                      <Button size="sm" variant="ghost" className="h-8 text-destructive" onClick={() => remove(l.item_id)} aria-label={`Remove ${l.area_name || l.name}`}><Trash2 className="h-4 w-4 mr-1" /> Remove</Button>
                    )}
                  </div>
                  {!removed && (
                    <div className="space-y-1.5" role="radiogroup" aria-label={`Options for ${l.area_name || l.name}`}>
                      {options.map((o) => {
                        const active = (o.product_id ?? null) === chosen;
                        const diff = o.unit_price - Number(l.unit_price);
                        return (
                          <button key={o.product_id ?? "orig"} type="button" role="radio" aria-checked={active} onClick={() => pick(l.item_id, o.product_id)}
                            className={`w-full text-left rounded-lg border px-3 py-2 text-sm flex items-center gap-2 ${active ? "border-[#0B4FA8] bg-blue-50" : "hover:bg-blue-50/50"}`}>
                            <span className={`h-4 w-4 shrink-0 rounded-full border flex items-center justify-center ${active ? "bg-[#0B4FA8] border-[#0B4FA8]" : ""}`}>{active && <Check className="h-3 w-3 text-white" />}</span>
                            <span className="min-w-0 flex-1 break-words">{o.name}{o.quoted && <span className="ml-1 text-xs text-muted-foreground">(quoted)</span>}</span>
                            <span className="text-right whitespace-nowrap">
                              <span className="block font-semibold text-[#0B4FA8]">{fmtZAR(o.unit_price)}</span>
                              {!o.quoted && <span className={`block text-[11px] ${diff > 0 ? "text-amber-700" : "text-emerald-700"}`}>{diff > 0 ? "+" : "−"}{fmtZAR(Math.abs(diff))}</span>}
                            </span>
                          </button>
                        );
                      })}
                      <p className="text-[11px] text-muted-foreground">Prices are per unit, supplied & installed, excl. VAT.</p>
                    </div>
                  )}
                </div>
              );
            })}
            <Textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 1000))} placeholder="Anything we should know? (optional)" className="rounded-xl min-h-[64px]" />
            {totals && (
              <div className="rounded-xl bg-blue-50 p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Original total</span><span>{fmtZAR(Number(data.original_total))}</span></div>
                {changed && (<>
                  {totals.discount > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span>-{fmtZAR(totals.discount)}</span></div>}
                  <div className="flex justify-between"><span className="text-muted-foreground">VAT</span><span>{fmtZAR(totals.vat)}</span></div>
                  <div className="flex justify-between font-bold text-[#0B4FA8] text-base"><span>New total incl. VAT</span><span>{fmtZAR(totals.total)}</span></div>
                </>)}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setOpen(false); load(); }} disabled={busy}>Cancel</Button>
              <Button onClick={submit} disabled={busy || !keptCount || !changed} className="bg-[#0B4FA8] hover:bg-[#0B4FA8]/90 text-white">
                {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Send for approval
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
