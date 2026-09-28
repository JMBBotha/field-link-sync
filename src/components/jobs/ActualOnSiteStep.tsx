/**
 * "Actual on site" — optional, prompted step in the tech completion flow.
 * Shows NO prices, costs or GP: only names, SKUs, quantities and hours.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { OverrunExtra } from "@/lib/overrun";

export interface ActualOnSiteValue { actualHours: string; extras: OverrunExtra[]; notes: string }
export const emptyActual = (): ActualOnSiteValue => ({ actualHours: "", extras: [], notes: "" });
export const hasActual = (v: ActualOnSiteValue) => v.actualHours.trim() !== "" || v.extras.length > 0 || v.notes.trim() !== "";

export default function ActualOnSiteStep({ value, onChange }: { value: ActualOnSiteValue; onChange: (v: ActualOnSiteValue) => void }) {
  const [q, setQ] = useState("");
  const [other, setOther] = useState("");
  const term = q.trim();
  const { data: hits = [] } = useQuery({
    queryKey: ["actual-onsite-search", term],
    enabled: term.length >= 2,
    staleTime: 60_000,
    queryFn: async () => {
      const safe = term.replace(/[%,()]/g, " ");
      const { data } = await (supabase.from("supplier_products") as any)
        .select("id, product_code, short_name").eq("archived", false)
        .or(`short_name.ilike.%${safe}%,product_code.ilike.%${safe}%`).limit(8);
      return (data || []) as { id: string; product_code: string | null; short_name: string | null }[];
    },
  });
  const add = (e: OverrunExtra) => onChange({ ...value, extras: [...value.extras, e] });
  const setQty = (i: number, qty: number) => onChange({ ...value, extras: value.extras.map((x, j) => (j === i ? { ...x, qty } : x)) });
  const remove = (i: number) => onChange({ ...value, extras: value.extras.filter((_, j) => j !== i) });

  return (
    <div className="space-y-3 rounded-lg border border-border p-3" data-testid="actual-on-site">
      <div>
        <p className="text-sm font-medium">Actual on site</p>
        <p className="text-xs text-muted-foreground">Optional — helps the office check the quote. Skip if nothing changed.</p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="actual-hours">Actual labour hours</Label>
        <Input id="actual-hours" type="number" inputMode="decimal" min="0" step="0.5" value={value.actualHours}
          onChange={(e) => onChange({ ...value, actualHours: e.target.value })} placeholder="e.g. 5.5" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="extra-search">Extra materials used</Label>
        <Input id="extra-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or code" />
        {hits.length > 0 && (
          <div className="rounded-md border border-border">
            {hits.map((h) => (
              <button key={h.id} type="button" className="block w-full px-2 py-1.5 text-left text-xs hover:bg-muted"
                onClick={() => { add({ product_id: h.id, name: h.short_name || h.product_code || "Item", qty: 1 }); setQ(""); }}>
                {h.short_name} <span className="text-muted-foreground">{h.product_code}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Input value={other} onChange={(e) => setOther(e.target.value)} placeholder="Anything else (free text)" />
          <Button type="button" variant="outline" size="icon" aria-label="Add free-text item" disabled={!other.trim()}
            onClick={() => { add({ product_id: null, name: other.trim().slice(0, 200), qty: 1 }); setOther(""); }}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        {value.extras.map((x, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="flex-1 truncate">{x.name}</span>
            <Input aria-label={`Quantity for ${x.name}`} className="h-8 w-20" type="number" min="0" step="0.5" value={x.qty}
              onChange={(e) => setQty(i, Number(e.target.value) || 0)} />
            <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${x.name}`} onClick={() => remove(i)}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
      </div>
      <div className="space-y-1">
        <Label htmlFor="actual-notes">Notes</Label>
        <Input id="actual-notes" value={value.notes} maxLength={1000} onChange={(e) => onChange({ ...value, notes: e.target.value })} placeholder="Why it took longer, what was extra…" />
      </div>
    </div>
  );
}

/** Save the step; job_id required. Quote comes from jobs.quote_id, else the lead's latest quote. */
export async function saveActualOnSite(opts: { jobId: string | null | undefined; leadId: string; userId: string; value: ActualOnSiteValue }) {
  const { jobId, leadId, userId, value } = opts;
  if (!jobId || !hasActual(value)) return false;
  const { data: job } = await (supabase.from("jobs") as any).select("quote_id").eq("id", jobId).maybeSingle();
  let quoteId: string | null = job?.quote_id ?? null;
  if (!quoteId) {
    const { data: q } = await (supabase.from("quotes") as any).select("id").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    quoteId = q?.id ?? null;
  }
  const h = Number(value.actualHours);
  const { error } = await (supabase.from("job_overruns" as any) as any).insert({
    job_id: jobId, quote_id: quoteId, created_by: userId,
    actual_hours: value.actualHours.trim() !== "" && Number.isFinite(h) && h >= 0 ? h : null,
    extra_items: value.extras.filter((x) => x.qty > 0), notes: value.notes.trim() || null,
  });
  if (error) throw error;
  return true;
}
