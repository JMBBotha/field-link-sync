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

  useEffect(() => {
    const loadFavorites = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        setUserId(user.id);

        const { data, error } = await supabase
          .from("product_favorites")
          .select("product_id")
          .eq("user_id", user.id);

        if (error) {
          console.error("[FAV] Load error:", error);
          return;
        }

        if (data && data.length > 0) {
          const dbFavs = new Set<string>(data.map((r) => r.product_id));
          const local = loadLocalFavorites();
          const merged = new Set([...local, ...dbFavs]);
          setFavorites(merged);
          localStorage.setItem(LS_FAVORITES_KEY, JSON.stringify([...merged]));
        }
      } catch (err) {
        console.error("[FAV] Load failed:", err);
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

      localStorage.setItem(LS_FAVORITES_KEY, JSON.stringify([...next]));

      if (userId) {
        if (nowFavorite) {
          supabase
            .from("product_favorites")
            .insert({ user_id: userId, product_id: productId })
            .then(({ error }) => {
              if (error) console.error("[FAV] DB insert error:", error);
            })
            .catch((err) => console.error("[FAV] DB insert failed:", err));
        } else {
          supabase
            .from("product_favorites")
            .delete()
            .eq("user_id", userId)
            .eq("product_id", productId)
            .then(({ error }) => {
              if (error) console.error("[FAV] DB delete error:", error);
            })
            .catch((err) => console.error("[FAV] DB delete failed:", err));
        }
      }
      return next;
    });
  }, [userId]);

  return { favorites, toggleFavorite };
}