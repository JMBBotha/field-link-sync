import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useProductUsageStats() {
  const [usageMap, setUsageMap] = useState<Record<string, number>>({});
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      const { data } = await (supabase.from("product_usage_stats") as any)
        .select("product_id, usage_count")
        .eq("user_id", user.id);

      if (data) {
        const map: Record<string, number> = {};
        data.forEach((r: any) => { map[r.product_id] = r.usage_count; });
        setUsageMap(map);
      }
    };
    load();
  }, []);

  const trackUsage = useCallback((productId: string) => {
    if (!userId) return;

    // Optimistic local update
    setUsageMap((prev) => ({
      ...prev,
      [productId]: (prev[productId] || 0) + 1,
    }));

    // Upsert in DB
    (supabase.from("product_usage_stats") as any)
      .upsert(
        {
          user_id: userId,
          product_id: productId,
          usage_count: (usageMap[productId] || 0) + 1,
          last_used_at: new Date().toISOString(),
        },
        { onConflict: "user_id,product_id" }
      )
      .then(({ error }: any) => {
        if (error) console.error("[USAGE] upsert error:", error);
      });
  }, [userId, usageMap]);

  return { usageMap, trackUsage };
}
