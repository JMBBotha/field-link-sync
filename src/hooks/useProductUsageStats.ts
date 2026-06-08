import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useProductUsageStats() {
  const [usageMap, setUsageMap] = useState<Record<string, number>>({});
  const [userId, setUserId] = useState<string | null>(null);
  const mountedRef = useRef(true);
  // Mirror of the latest usageMap so trackUsage can compute correct counts
  // without depending on usageMap (avoids stale-closure double-write bug).
  const usageMapRef = useRef<Record<string, number>>({});

  useEffect(() => { usageMapRef.current = usageMap; }, [usageMap]);

  useEffect(() => {
    mountedRef.current = true;
    const load = async () => {
      const { data: { user }, error: userErr } = await supabase.auth.getUser();
      if (userErr) {
        console.error("[USAGE] getUser error:", userErr);
        return;
      }
      if (!user || !mountedRef.current) return;
      setUserId(user.id);

      const { data, error } = await supabase
        .from("product_usage_stats")
        .select("product_id, usage_count")
        .eq("user_id", user.id);

      if (!mountedRef.current) return;
      if (error) {
        console.error("[USAGE] load error:", error);
        return;
      }
      if (data) {
        const map: Record<string, number> = {};
        data.forEach((r) => { map[r.product_id] = r.usage_count; });
        setUsageMap(map);
      }
    };
    load().catch((err) => console.error("[USAGE] load failed:", err));
    return () => { mountedRef.current = false; };
  }, []);

  const trackUsage = useCallback((productId: string) => {
    if (!userId) return;

    // Compute the next count from the ref so rapid successive calls increment correctly
    const nextCount = (usageMapRef.current[productId] || 0) + 1;

    // Optimistic local update (functional form keeps it consistent with concurrent updates)
    setUsageMap((prev) => ({
      ...prev,
      [productId]: (prev[productId] || 0) + 1,
    }));

    supabase
      .from("product_usage_stats")
      .upsert(
        {
          user_id: userId,
          product_id: productId,
          usage_count: nextCount,
          last_used_at: new Date().toISOString(),
        },
        { onConflict: "user_id,product_id" }
      )
      .then(({ error }) => {
        if (error) console.error("[USAGE] upsert error:", error);
      });
  }, [userId]);

  return { usageMap, trackUsage };
}
