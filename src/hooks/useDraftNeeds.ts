import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { draftNeeds } from "@/lib/quoteBundle";

type Line = Parameters<typeof draftNeeds>[1][number] & { quote_id: string };

/** For draft quote ids: what each still needs before Send (client, lines, prices). Keyed by quote id. */
export function useDraftNeeds(drafts: { id: string; customer_id?: string | null }[]) {
  const [needs, setNeeds] = useState<Record<string, string[]>>({});
  const key = drafts.map((d) => `${d.id}:${d.customer_id || ""}`).sort().join(",");
  useEffect(() => {
    if (!drafts.length) { setNeeds({}); return; }
    let live = true;
    (async () => {
      const ids = drafts.map((d) => d.id);
      const { data, error } = await supabase.from("quote_items")
        .select("id, quote_id, item_name, item_type, unit_price, quantity, parent_item_id, metadata").in("quote_id", ids);
      if (!live || error) return;
      const by: Record<string, Line[]> = {};
      for (const l of (data || []) as unknown as Line[]) (by[l.quote_id] ||= []).push(l);
      setNeeds(Object.fromEntries(drafts.map((d) => [d.id, draftNeeds(d.customer_id, by[d.id] || [])])));
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return needs;
}
