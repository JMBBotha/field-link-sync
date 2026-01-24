import { useState, useEffect, useCallback } from "react";
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

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error: fetchError } = await supabase
        .from("admin_settings")
        .select("setting_key, setting_value")
        .in("setting_key", [
          "broadcast_radius_sales",
          "broadcast_radius_technical",
          "broadcast_radius_default",
        ]);

      if (fetchError) throw fetchError;

      const newSettings: AdminSettings = { ...DEFAULT_BROADCAST_RADIUS };

      data?.forEach((row) => {
        const value = (row.setting_value as any)?.radius_km;
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
    } catch (err: any) {
      console.error("Error fetching broadcast settings:", err);
      setError(err.message);
    } finally {
      setLoading(false);
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

        setSettings((prev) => ({ ...prev, ...newSettings }));
        return true;
      } catch (err: any) {
        console.error("Error updating broadcast settings:", err);
        setError(err.message);
        return false;
      }
    },
    []
  );

  useEffect(() => {
    fetchSettings();

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
          fetchSettings();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
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
