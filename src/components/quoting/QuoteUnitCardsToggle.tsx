import { useEffect, useState } from "react";
import { LayoutGrid } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { rollupLineFromRow } from "@/lib/clientQuoteRollup";
import { missingModelKeys, unitLineModelKey, type ProductMedia } from "@/lib/unitCards";
import { ensureUnitContent } from "./QuoteUnitCards";

/**
 * Staff strip on the quote page: per-quote on/off for "The units in this quote" (default on), card status,
 * and the on-demand fetch for models with no content yet (runs in the background, never blocks quoting).
 */
export default function QuoteUnitCardsToggle({ quoteId }: { quoteId: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [revision, setRevision] = useState(0);
  const [stats, setStats] = useState<{ models: number; approved: number; pending: number; fetching: number }>({ models: 0, approved: 0, pending: 0, fetching: 0 });

  useEffect(() => {
    const channel = supabase.channel(`unit-content-quote-${quoteId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "quote_items", filter: `quote_id=eq.${quoteId}` }, () => setRevision((r) => r + 1))
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [quoteId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ data: q }, { data: items }] = await Promise.all([
          (supabase.from("quotes") as any).select("show_unit_cards").eq("id", quoteId).maybeSingle(),
          (supabase.from("quote_items") as any)
            .select("id, item_name, item_type, item_number, quantity, is_bundle, metadata, product_id, area_id, parent_item_id, supplier_products(category, brand, btu_rating, capacity_btu, kw, product_code)")
            .eq("quote_id", quoteId).is("parent_item_id", null),
        ]);
        if (cancelled) return;
        setOn(q?.show_unit_cards !== false);
        const lines = ((items || []) as any[]).map((r) => ({ ...rollupLineFromRow(r), metadata: r.metadata }));
        const keys = [...new Set(lines.map((l) => unitLineModelKey(l as any)).filter(Boolean))] as string[];
        if (!keys.length) return;
        const { data: media } = await (supabase.from("product_media" as never) as any).select("model_key, status").in("model_key", keys);
        const rows = (media || []) as ProductMedia[];
        const missing = missingModelKeys(lines as any, rows.map((r) => r.model_key));
        if (!cancelled) setStats({ models: keys.length, approved: rows.filter((r) => r.status === "approved").length, pending: rows.filter((r) => r.status !== "approved").length, fetching: missing.length });
        if (missing.length) void ensureUnitContent(missing);
      } catch { /* optional */ }
    })();
    return () => { cancelled = true; };
  }, [quoteId, revision]);

  const toggle = async (v: boolean) => {
    setOn(v);
    const { error } = await (supabase.from("quotes") as any).update({ show_unit_cards: v }).eq("id", quoteId);
    if (error) setOn(!v);
  };

  if (on === null) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-2 text-sm print:hidden" data-testid="unit-cards-toggle">
      <LayoutGrid className="h-4 w-4 text-muted-foreground" />
      <span className="font-medium">Unit cards on client quote</span>
      <Switch data-no-min="" checked={on} onCheckedChange={toggle} aria-label="Show unit cards on the client quote" />
      {stats.models > 0 && (
        <span className="text-xs text-muted-foreground">
          {stats.approved}/{stats.models} model{stats.models === 1 ? "" : "s"} with approved content
          {stats.pending + stats.fetching > 0 ? ` · ${stats.pending + stats.fetching} awaiting approval (simple card shown until then)` : ""}
        </span>
      )}
    </div>
  );
}
