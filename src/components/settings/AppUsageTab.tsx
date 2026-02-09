import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { LogIn, Briefcase, WifiOff, Users, Activity, Bug } from "lucide-react";

const MetricCard = ({
  label,
  value,
  icon: Icon,
  loading,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  loading: boolean;
}) => (
  <Card>
    <CardContent className="flex items-center gap-4 p-4">
      <div className="rounded-lg bg-primary/10 p-2.5">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        {loading ? (
          <Skeleton className="h-7 w-16 mt-1" />
        ) : (
          <p className="text-2xl font-bold">{value}</p>
        )}
      </div>
    </CardContent>
  </Card>
);

const AppUsageTab = () => {
  const { data: totalLogins, isLoading: loginsLoading } = useQuery({
    queryKey: ["app-usage-logins"],
    queryFn: async () => {
      const { count } = await supabase
        .from("app_usage_events")
        .select("*", { count: "exact", head: true })
        .eq("event_type", "login");
      return count ?? 0;
    },
  });

  const { data: jobsCreated, isLoading: jobsLoading } = useQuery({
    queryKey: ["app-usage-jobs"],
    queryFn: async () => {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const monthAgo = new Date();
      monthAgo.setDate(monthAgo.getDate() - 30);

      const [weekRes, monthRes] = await Promise.all([
        supabase
          .from("leads")
          .select("*", { count: "exact", head: true })
          .gte("created_at", weekAgo.toISOString()),
        supabase
          .from("leads")
          .select("*", { count: "exact", head: true })
          .gte("created_at", monthAgo.toISOString()),
      ]);
      return { week: weekRes.count ?? 0, month: monthRes.count ?? 0 };
    },
  });

  const { data: offlineSessions, isLoading: offlineLoading } = useQuery({
    queryKey: ["app-usage-offline"],
    queryFn: async () => {
      const { count } = await supabase
        .from("sync_conflicts")
        .select("*", { count: "exact", head: true });
      return count ?? 0;
    },
  });

  const { data: activeUsers, isLoading: usersLoading } = useQuery({
    queryKey: ["app-usage-active-users"],
    queryFn: async () => {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const { data } = await supabase
        .from("app_usage_events")
        .select("user_id")
        .gte("created_at", weekAgo.toISOString())
        .not("user_id", "is", null);
      const unique = new Set((data || []).map((r) => r.user_id));
      return unique.size;
    },
  });

  const sentrySet = !!import.meta.env.VITE_SENTRY_DSN;
  const posthogSet = !!import.meta.env.VITE_POSTHOG_KEY;

  return (
    <div className="space-y-6 pt-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <MetricCard label="Total Logins" value={totalLogins ?? 0} icon={LogIn} loading={loginsLoading} />
        <MetricCard
          label="Jobs Created (Week)"
          value={jobsCreated?.week ?? 0}
          icon={Briefcase}
          loading={jobsLoading}
        />
        <MetricCard
          label="Jobs Created (Month)"
          value={jobsCreated?.month ?? 0}
          icon={Briefcase}
          loading={jobsLoading}
        />
        <MetricCard
          label="Offline Sync Conflicts"
          value={offlineSessions ?? 0}
          icon={WifiOff}
          loading={offlineLoading}
        />
        <MetricCard
          label="Active Users (7 days)"
          value={activeUsers ?? 0}
          icon={Users}
          loading={usersLoading}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monitoring Status</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Bug className="h-4 w-4" />
            <span className="text-sm">Sentry</span>
            <Badge variant={sentrySet ? "default" : "secondary"} className={sentrySet ? "bg-green-600" : ""}>
              {sentrySet ? "Active" : "Not configured"}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            <span className="text-sm">PostHog</span>
            <Badge variant={posthogSet ? "default" : "secondary"} className={posthogSet ? "bg-green-600" : ""}>
              {posthogSet ? "Active" : "Not configured"}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AppUsageTab;
