import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { isAirConditioningProduct } from "@/lib/mandy/quoteOps";
import type { PaletteProduct } from "@/components/catalog/QuoteBuilderTab";
import type { CatalogService } from "@/lib/catalogServices";

export type FavouritesSource = "personal" | "shared";
interface FavState { source: FavouritesSource; ids: string[] }

/**
 * Pure: what a toggle writes. From the shared set, the user's personal rows are
 * first seeded with every shared id, then the toggle applies — so starring one
 * product never makes the shared favourites vanish.
 */
export function planFavouriteToggle(source: FavouritesSource, currentIds: Iterable<string>, productId: string) {
  const current = new Set(currentIds);
  const seed = source === "shared" ? [...current] : [];
  const adding = !current.has(productId);
  const next = new Set(current);
  if (adding) next.add(productId); else next.delete(productId);
  const inserts = adding ? [...seed.filter((id) => id !== productId), productId] : seed.filter((id) => id !== productId);
  const deletes = !adding && source === "personal" ? [productId] : [];
  return { adding, next, inserts, deletes };
}

/** Pure: split favourites for the picker; archived/off-book favourites are hidden and counted. */
export function groupFavourites(favIds: Iterable<string>, liveProducts: PaletteProduct[], services: CatalogService[]) {
  const byId = new Map(liveProducts.map((p) => [p.id, p]));
  const units: PaletteProduct[] = [];
  const materials: PaletteProduct[] = [];
  let hiddenCount = 0;
  for (const id of new Set(favIds)) {
    const p = byId.get(id);
    if (!p) { hiddenCount++; continue; }
    (isAirConditioningProduct(p) ? units : materials).push(p);
  }
  return { units, materials, services: services.filter((s) => s.is_active !== false), hiddenCount };
}

export function useQuoteFavourites() {
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    supabase.auth.getUser().then(({ data }) => { if (!off) setUserId(data.user?.id ?? null); });
    return () => { off = true; };
  }, []);
  const key = ["quote-favourites", userId];

  const { data, isLoading } = useQuery({
    queryKey: key,
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<FavState> => {
      const { data: mine, error } = await supabase
        .from("product_favorites").select("product_id, created_at").eq("user_id", userId ?? "");
      if (error) throw error;
      return { source: "personal", ids: (mine ?? []).map((r) => r.product_id) };
    },
  });

   const state: FavState = data ?? { source: "personal", ids: [] };
  const ids = new Set(state.ids);

  const toggle = useCallback(async (productId: string): Promise<boolean | null> => {
    if (!userId) return null;
    const prev = qc.getQueryData<FavState>(key) ?? state;
    const plan = planFavouriteToggle(prev.source, prev.ids, productId);
    qc.setQueryData<FavState>(key, { source: "personal", ids: [...plan.next] });
    try {
      if (plan.inserts.length) {
        const { error } = await supabase.from("product_favorites")
          .insert(plan.inserts.map((product_id) => ({ user_id: userId, product_id })));
        if (error) throw error;
      }
      if (plan.deletes.length) {
        const { error } = await supabase.from("product_favorites")
          .delete().eq("user_id", userId).in("product_id", plan.deletes);
        if (error) throw error;
      }
      return plan.adding;
    } catch (err) {
      console.error("[favourites] toggle failed", err);
      qc.setQueryData<FavState>(key, prev);
      toast({ title: "Couldn't update favourite", variant: "destructive" });
      return null;
    } finally {
      qc.invalidateQueries({ queryKey: key });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, qc, state.source, state.ids.join(",")]);

  return {
    source: state.source,
    ids,
    isFavourite: (id: string) => ids.has(id),
    toggle,
    loading: isLoading,
  };
}
