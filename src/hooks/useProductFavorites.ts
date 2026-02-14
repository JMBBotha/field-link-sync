import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

const LS_FAVORITES_KEY = "quote-builder-favorites";

function loadLocalFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_FAVORITES_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

export function useProductFavorites() {
  const [favorites, setFavorites] = useState<Set<string>>(loadLocalFavorites);
  const [userId, setUserId] = useState<string | null>(null);

  // Get user and load DB favorites
  useEffect(() => {
    const loadFavorites = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      const { data } = await (supabase.from("product_favorites") as any)
        .select("product_id")
        .eq("user_id", user.id);

      if (data && data.length > 0) {
        const dbFavs = new Set<string>(data.map((r: any) => r.product_id));
        // Merge with local
        const local = loadLocalFavorites();
        const merged = new Set([...local, ...dbFavs]);
        setFavorites(merged);
        localStorage.setItem(LS_FAVORITES_KEY, JSON.stringify([...merged]));
      }
    };
    loadFavorites();
  }, []);

  const toggleFavorite = useCallback((productId: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      const nowFavorite = !next.has(productId);
      if (nowFavorite) next.add(productId);
      else next.delete(productId);

      // Persist locally
      localStorage.setItem(LS_FAVORITES_KEY, JSON.stringify([...next]));

      // Persist to DB
      if (userId) {
        if (nowFavorite) {
          (supabase.from("product_favorites") as any)
            .insert({ user_id: userId, product_id: productId })
            .then(({ error }: any) => {
              if (error) console.error("[FAV] DB insert error:", error);
            });
        } else {
          (supabase.from("product_favorites") as any)
            .delete()
            .eq("user_id", userId)
            .eq("product_id", productId)
            .then(({ error }: any) => {
              if (error) console.error("[FAV] DB delete error:", error);
            });
        }
      }

      console.log(`[FAV] toggled product ${productId} → ${nowFavorite}`);
      return next;
    });
  }, [userId]);

  return { favorites, toggleFavorite };
}
