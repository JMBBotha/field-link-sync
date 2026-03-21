import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bell, AlertTriangle, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface AdminAlert {
  id: string;
  alert_type: string;
  severity: string;
  title: string;
  message: string;
  data: any;
  is_read: boolean;
  created_at: string;
}

const severityConfig: Record<string, { icon: any; color: string; bg: string }> = {
  info: { icon: Bell, color: "text-blue-600", bg: "bg-blue-50" },
  warning: { icon: AlertTriangle, color: "text-orange-600", bg: "bg-orange-50" },
  critical: { icon: AlertTriangle, color: "text-red-600", bg: "bg-red-50" },
};

export default function AdminAlertsPanel() {
  const [alerts, setAlerts] = useState<AdminAlert[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAlerts = async () => {
    const { data } = await (supabase
      .from("admin_alerts" as any)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20) as any);
    setAlerts(data || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchAlerts();

    // Real-time subscription for new alerts
    const channel = supabase
      .channel("admin-alerts")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "admin_alerts" }, (payload) => {
        setAlerts((prev) => [payload.new as AdminAlert, ...prev]);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const markRead = async (alertId: string) => {
    await (supabase.from("admin_alerts" as any) as any).update({ is_read: true }).eq("id", alertId);
    setAlerts((prev) => prev.map((a) => (a.id === alertId ? { ...a, is_read: true } : a)));
  };

  const dismissAll = async () => {
    const unreadIds = alerts.filter((a) => !a.is_read).map((a) => a.id);
    if (unreadIds.length === 0) return;
    await (supabase.from("admin_alerts" as any) as any).update({ is_read: true }).in("id", unreadIds);
    setAlerts((prev) => prev.map((a) => ({ ...a, is_read: true })));
  };

  const unreadCount = alerts.filter((a) => !a.is_read).length;

  if (loading) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Alerts</CardTitle>
            {unreadCount > 0 && (
              <Badge variant="destructive" className="text-xs">{unreadCount}</Badge>
            )}
          </div>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="text-xs" onClick={dismissAll}>
              Mark all read
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 max-h-80 overflow-y-auto">
        {alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No alerts</p>
        ) : (
          alerts.map((alert) => {
            const config = severityConfig[alert.severity] || severityConfig.info;
            const Icon = config.icon;
            return (
              <div
                key={alert.id}
                className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                  alert.is_read ? "opacity-60" : config.bg
                }`}
              >
                <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${config.color}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{alert.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{alert.message}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}
                  </p>
                </div>
                {!alert.is_read && (
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" onClick={() => markRead(alert.id)}>
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
