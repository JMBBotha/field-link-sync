import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BroadcastRadiusSettings, DEFAULT_BROADCAST_RADIUS } from "@/lib/geolocation";

interface AdminSettings {
  sales: number;
  technical: number;
  default: number;
}

export const useBroadcastSettings = () => {
  const [settings, setSettings] = useState<BroadcastRadiusSettings>(DEFAULT_BROADCAST_RADIUS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const fetchSeqRef = useRef(0);

  const fetchSettings = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    try {
      if (mountedRef.current) setLoading(true);
      const { data, error: fetchError } = await supabase
        .from("admin_settings")
        .select("setting_key, setting_value")
        .in("setting_key", [
          "broadcast_radius_sales",
          "broadcast_radius_technical",
          "broadcast_radius_default",
        ]);

      if (!mountedRef.current || seq !== fetchSeqRef.current) return;
      if (fetchError) throw fetchError;

      const newSettings: AdminSettings = { ...DEFAULT_BROADCAST_RADIUS };

      data?.forEach((row) => {
        const settingValue = row.setting_value as { radius_km?: unknown } | null;
        const value = settingValue?.radius_km;
        if (typeof value === "number") {
          if (row.setting_key === "broadcast_radius_sales") {
            newSettings.sales = value;
          } else if (row.setting_key === "broadcast_radius_technical") {
            newSettings.technical = value;
          } else if (row.setting_key === "broadcast_radius_default") {
            newSettings.default = value;
          }
        }
      });

      setSettings(newSettings);
      setError(null);
    } catch (err: unknown) {
      console.error("Error fetching broadcast settings:", err);
      if (mountedRef.current && seq === fetchSeqRef.current) {
        setError(err instanceof Error ? err.message : "Failed to fetch settings");
      }
    } finally {
      if (mountedRef.current && seq === fetchSeqRef.current) setLoading(false);
    }
  }, []);

  const updateSettings = useCallback(
    async (newSettings: Partial<BroadcastRadiusSettings>) => {
      try {
        const updates = [];

        if (newSettings.sales !== undefined) {
          updates.push(
            supabase
              .from("admin_settings")
              .upsert(
                {
                  setting_key: "broadcast_radius_sales",
                  setting_value: { radius_km: newSettings.sales },
                  updated_at: new Date().toISOString(),
                },
                { onConflict: "setting_key" }
              )
          );
        }

        if (newSettings.technical !== undefined) {
          updates.push(
            supabase
              .from("admin_settings")
              .upsert(
                {
                  setting_key: "broadcast_radius_technical",
                  setting_value: { radius_km: newSettings.technical },
                  updated_at: new Date().toISOString(),
                },
                { onConflict: "setting_key" }
              )
          );
        }

        if (newSettings.default !== undefined) {
          updates.push(
            supabase
              .from("admin_settings")
              .upsert(
                {
                  setting_key: "broadcast_radius_default",
                  setting_value: { radius_km: newSettings.default },
                  updated_at: new Date().toISOString(),
                },
                { onConflict: "setting_key" }
              )
          );
        }

        await Promise.all(updates);

        if (mountedRef.current) {
          setSettings((prev) => ({ ...prev, ...newSettings }));
        }
        return true;
      } catch (err: unknown) {
        console.error("Error updating broadcast settings:", err);
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : "Failed to update settings");
        }
        return false;
      }
    },
    []
  );

  useEffect(() => {
    mountedRef.current = true;
    void fetchSettings();

    // Subscribe to settings changes
    const channel = supabase
      .channel("admin-settings-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "admin_settings",
        },
        () => {
          void fetchSettings();
        }
      )
      .subscribe();

    return () => {
      mountedRef.current = false;
      void supabase.removeChannel(channel);
    };
  }, [fetchSettings]);

  return {
    settings,
    loading,
    error,
    updateSettings,
    refetch: fetchSettings,
  };
};
