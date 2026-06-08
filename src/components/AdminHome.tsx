import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, FileText, BarChart3, ClipboardList, AlertTriangle, CheckCircle2, Clock, DollarSign, Users, Wrench } from "lucide-react";
import { Briefcase, UserCheck, Timer, TrendingUp, TrendingDown } from "lucide-react";
import AdminAlertsPanel from "@/components/AdminAlertsPanel";
// Jobs & Dispatch KPI dashboard section
import CompletedLeadsList from "@/components/admin/CompletedLeadsList";
import SyncConflictsSection from "@/components/admin/SyncConflictsSection";
import KpiDetailDialog from "@/components/admin/KpiDetailDialog";
import QuotePerformanceWidget from "@/components/analytics/QuotePerformanceWidget";
import { format, subDays } from "date-fns";
import { useState, useMemo } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from "recharts";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { Link } from "react-router-dom";

interface AdminHomeProps {
  onNavigate: (tab: string) => void;
  onCreateLead: () => void;
}

const AdminHome = ({ onNavigate, onCreateLead }: AdminHomeProps) => {
  const today = new Date().toISOString().split("T")[0];
  const [selectedKpi, setSelectedKpi] = useState<string | null>(null);
  const { companyId } = useUserCompanyId();

  // Jobs & Assignments KPI query
  const { data: jobStats } = useQuery({
    queryKey: ["jobs-kpi-stats", companyId],
    queryFn: async () => {
      if (!companyId) return null;
      const [jobsRes, assignmentsRes, completedRes] = await Promise.all([
        supabase.from("jobs").select("id, status, created_at, updated_at").eq("company_id", companyId),
        supabase.from("assignments").select("id, status, profile_id").eq("status", "proposed"),
        supabase.from("jobs").select("id, created_at, updated_at").eq("company_id", companyId).eq("status", "completed"),
      ]);

      const jobs = jobsRes.data || [];
      const totalJobs = jobs.length;
      const activeJobs = jobs.filter(j => j.status === "in_progress").length;
      const completedJobs = jobs.filter(j => j.status === "completed").length;
      const pendingAssignments = assignmentsRes.data?.length || 0;

      // Active field agents (unique agents with active assignments)
      const activeAgentsRes = await supabase
        .from("assignments")
        .select("profile_id")
        .in("status", ["accepted", "in_progress"]);
      const uniqueAgents = new Set((activeAgentsRes.data || []).map(a => a.profile_id));

      // Avg completion time in days
      const completed = completedRes.data || [];
      let avgCompletionDays = 0;
      if (completed.length > 0) {
        const totalMs = completed.reduce((sum, j) => {
          const created = new Date(j.created_at).getTime();
          const updated = new Date(j.updated_at!).getTime();
          return sum + (updated - created);
        }, 0);
        avgCompletionDays = Math.round((totalMs / completed.length) / (1000 * 60 * 60 * 24) * 10) / 10;
      }

      // Status breakdown
      const statusCounts: Record<string, number> = {};
      jobs.forEach(j => {
        const s = j.status || "unknown";
        statusCounts[s] = (statusCounts[s] || 0) + 1;
      });
      const statusBreakdown = Object.entries(statusCounts).map(([status, count]) => ({ status, count }));

      return { totalJobs, activeJobs, completedJobs, pendingAssignments, activeFieldAgents: uniqueAgents.size, avgCompletionDays, statusBreakdown };
    },
    enabled: !!companyId,
    staleTime: 30000,
  });

  const statusColors: Record<string, string> = {
    pending: "hsl(var(--chart-4))",
    scheduled: "hsl(var(--chart-2))",
    dispatched: "hsl(var(--chart-5))",
    in_progress: "hsl(var(--chart-1))",
    completed: "hsl(var(--chart-3))",
    cancelled: "hsl(var(--muted-foreground))",
  };

  const { data: stats, isLoading } = useQuery({
    queryKey: ["admin-home-stats", today],
    queryFn: async () => {
      const [leadsRes, quotesRes, activeJobsRes, overdueRes, revenueRes, agentsRes, recentRes, overdueMaintenanceRes] = await Promise.all([
        supabase.from("leads").select("id", { count: "exact", head: true }).gte("created_at", today + "T00:00:00").eq("status", "pending"),
        supabase.from("quotes").select("id", { count: "exact", head: true }).eq("status", "draft"),
        supabase.from("leads").select("id", { count: "exact", head: true }).in("status", ["accepted", "en_route", "on_site"]),
        supabase.from("invoices").select("id", { count: "exact", head: true }).eq("status", "overdue"),
        supabase.from("invoices").select("grand_total").eq("status", "paid").gte("paid_date", today),
        supabase.from("profiles").select("id, full_name, availability_status").limit(20),
        supabase.from("notifications").select("id, type, title, body, created_at").order("created_at", { ascending: false }).limit(15),
        supabase.rpc("get_overdue_maintenance_count"),
      ]);

      const revenueToday = revenueRes.data?.reduce((sum, inv) => sum + Number(inv.grand_total || 0), 0) || 0;

      return {
        newLeads: leadsRes.count || 0,
        pendingQuotes: quotesRes.count || 0,
        activeJobs: activeJobsRes.count || 0,
        overdueInvoices: overdueRes.count || 0,
        overdueMaintenance: (overdueMaintenanceRes.data as number) || 0,
        revenueToday,
        agents: agentsRes.data || [],
        recentActivity: recentRes.data || [],
      };
    },
    refetchInterval: 30000,
  });

  // Fetch 7-day trend data for sparklines
  const sevenDaysAgo = subDays(new Date(), 6).toISOString().split("T")[0];
  const { data: trendData } = useQuery({
    queryKey: ["kpi-trends", sevenDaysAgo],
    queryFn: async () => {
      const [leadsRes, revenueRes] = await Promise.all([
        supabase.from("leads").select("created_at, status").gte("created_at", sevenDaysAgo + "T00:00:00"),
        supabase.from("invoices").select("paid_date, grand_total").eq("status", "paid").gte("paid_date", sevenDaysAgo),
      ]);

      const days: Record<string, { leads: number; active: number; revenue: number }> = {};
      for (let i = 0; i < 7; i++) {
        const d = subDays(new Date(), 6 - i).toISOString().split("T")[0];
        days[d] = { leads: 0, active: 0, revenue: 0 };
      }
      (leadsRes.data || []).forEach((l) => {
        const d = l.created_at?.split("T")[0];
        if (d && days[d]) {
          days[d].leads++;
          if (["accepted", "en_route", "on_site"].includes(l.status)) days[d].active++;
        }
      });
      (revenueRes.data || []).forEach((inv) => {
        const d = inv.paid_date?.split("T")[0];
        if (d && days[d]) days[d].revenue += Number(inv.grand_total || 0);
      });

      return Object.entries(days).map(([date, v]) => ({ date, ...v }));
    },
    staleTime: 60000,
  });

  const kpiCards = useMemo(() => [
    { key: "new_leads", label: "New Leads Today", value: stats?.newLeads ?? 0, icon: Plus, color: "text-blue-500", sparkKey: "leads" as const, sparkColor: "#3b82f6" },
    { key: "pending_quotes", label: "Pending Quotes", value: stats?.pendingQuotes ?? 0, icon: FileText, color: "text-orange-500", sparkKey: "leads" as const, sparkColor: "#f97316" },
    { key: "active_jobs", label: "Active Jobs", value: stats?.activeJobs ?? 0, icon: Clock, color: "text-green-500", sparkKey: "active" as const, sparkColor: "#22c55e" },
    { key: "overdue_invoices", label: "Overdue Invoices", value: stats?.overdueInvoices ?? 0, icon: AlertTriangle, color: "text-destructive", sparkKey: "leads" as const, sparkColor: "#ef4444" },
    { key: "overdue_maintenance", label: "Overdue Maintenance", value: stats?.overdueMaintenance ?? 0, icon: Wrench, color: "text-red-500", sparkKey: "leads" as const, sparkColor: "#ef4444" },
    { key: "revenue_today", label: "Revenue Today", value: `R ${(stats?.revenueToday ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`, icon: DollarSign, color: "text-primary", sparkKey: "revenue" as const, sparkColor: "#0077B6" },
  ], [stats]);

  const activeKpi = kpiCards.find((k) => k.key === selectedKpi);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* KPI Cards */}
      {/* Jobs & Dispatch KPIs */}
      {jobStats && (
        <>
          <div>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Briefcase className="h-5 w-5 text-primary" /> Jobs & Dispatch Overview
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { label: "Total Jobs", value: jobStats.totalJobs, icon: Briefcase, color: "text-primary", to: "/admin/jobs-dispatch" },
                { label: "Active Jobs", value: jobStats.activeJobs, icon: Clock, color: "text-chart-1", to: "/admin/jobs-dispatch" },
                { label: "Completed", value: jobStats.completedJobs, icon: CheckCircle2, color: "text-chart-3", to: "/admin/jobs-dispatch" },
                { label: "Pending Assignments", value: jobStats.pendingAssignments, icon: ClipboardList, color: "text-chart-4", to: "/admin/dispatch" },
                { label: "Active Agents", value: jobStats.activeFieldAgents, icon: UserCheck, color: "text-chart-2", to: "/admin/team" },
                { label: "Avg Completion", value: `${jobStats.avgCompletionDays}d`, icon: Timer, color: "text-chart-5", to: "/admin/analytics" },
              ].map((card) => (
                <Link key={card.label} to={card.to} className="block focus:outline-none focus:ring-2 focus:ring-primary rounded-xl">
                  <Card className="rounded-xl border border-border cursor-pointer transition-all duration-200 hover:border-primary/30 hover:bg-muted/40 hover:shadow-md">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <card.icon className={`h-4 w-4 ${card.color}`} />
                        <span className="text-xs text-muted-foreground">{card.label}</span>
                      </div>
                      <p className="text-2xl font-bold">{card.value}</p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>

          {/* Jobs by Status Chart */}
          {jobStats.statusBreakdown.length > 0 && (
            <Card className="rounded-xl border border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Jobs by Status</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={jobStats.statusBreakdown} layout="vertical" margin={{ left: 80 }}>
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                      <YAxis
                        type="category"
                        dataKey="status"
                        tick={{ fontSize: 12 }}
                        tickFormatter={(v: string) => v.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                      />
                      <Tooltip
                        formatter={(value: number) => [value, "Jobs"]}
                        labelFormatter={(v: string) => v.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                      />
                      <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                        {jobStats.statusBreakdown.map((entry) => (
                          <Cell key={entry.status} fill={statusColors[entry.status] || "hsl(var(--muted-foreground))"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Existing KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-4 rounded dark:bg-slate-700/30" />
                    <Skeleton className="h-3 w-20 dark:bg-slate-700/30" />
                  </div>
                  <Skeleton className="h-8 w-16 dark:bg-slate-700/30" />
                  <Skeleton className="h-6 w-full rounded dark:bg-slate-700/30" />
                </CardContent>
              </Card>
            ))
          : kpiCards.map((kpi) => (
              <Card
                key={kpi.key}
                className="cursor-pointer rounded-xl border border-border transition-all duration-200 hover:border-primary/30 hover:bg-muted/40 dark:hover:bg-[#1a2a4a]/50 hover:shadow-md"
                onClick={() => setSelectedKpi(kpi.key)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <kpi.icon className={`h-4 w-4 ${kpi.color}`} />
                    <span className="text-xs text-muted-foreground">{kpi.label}</span>
                  </div>
                  <p className="text-2xl font-bold">{kpi.value}</p>
                  {trendData && trendData.length > 0 && (
                    <div className="h-8 mt-1 -mx-1">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={trendData}>
                          <defs>
                            <linearGradient id={`grad-${kpi.key}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={kpi.sparkColor} stopOpacity={0.4} />
                              <stop offset="100%" stopColor={kpi.sparkColor} stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <Area
                            type="monotone"
                            dataKey={kpi.sparkKey}
                            stroke={kpi.sparkColor}
                            strokeWidth={1.5}
                            fill={`url(#grad-${kpi.key})`}
                            dot={false}
                            isAnimationActive={false}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
      </div>

      {/* KPI Detail Dialog */}
      {activeKpi && (
        <KpiDetailDialog
          open={!!selectedKpi}
          onOpenChange={(open) => !open && setSelectedKpi(null)}
          kpiKey={activeKpi.key}
          label={activeKpi.label}
          icon={activeKpi.icon}
          color={activeKpi.color}
        />
      )}

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2">
        <Button onClick={onCreateLead}><Plus className="mr-2 h-4 w-4" />New Lead</Button>
        <Button variant="outline" onClick={() => onNavigate("quotes")}><FileText className="mr-2 h-4 w-4" />New Quote</Button>
        <Button variant="outline" onClick={() => onNavigate("analytics")}><BarChart3 className="mr-2 h-4 w-4" />Analytics</Button>
        <Button variant="outline" onClick={() => onNavigate("reports")}><ClipboardList className="mr-2 h-4 w-4" />Reports</Button>
      </div>

      {/* Quote Performance Widget */}
      <QuotePerformanceWidget />

      {/* Completed Leads */}
      <CompletedLeadsList />

      {/* Admin Alerts */}
      <AdminAlertsPanel />

      <div className="grid md:grid-cols-2 gap-6">
        {/* Sync Conflicts */}
        <SyncConflictsSection />
        {/* Recent Activity */}
        <Card>
          <CardHeader><CardTitle className="text-base">Recent Activity</CardTitle></CardHeader>
          <CardContent className="space-y-3 max-h-80 overflow-y-auto">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)
            ) : stats?.recentActivity.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No recent activity</p>
            ) : (
              stats?.recentActivity.map((activity) => (
                <div key={activity.id} className="flex items-start gap-3 p-2 rounded-md hover:bg-muted/50">
                  <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{activity.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{activity.body}</p>
                    <p className="text-xs text-muted-foreground">{format(new Date(activity.created_at), "dd MMM HH:mm")}</p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Agent Status */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" />Agent Status</CardTitle></CardHeader>
          <CardContent className="space-y-3 max-h-80 overflow-y-auto">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)
            ) : (
              stats?.agents.map((agent) => (
                <div key={agent.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50">
                  <span className="text-sm font-medium">{agent.full_name}</span>
                  <Badge variant={agent.availability_status === "available" ? "default" : "secondary"}>
                    {agent.availability_status || "offline"}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AdminHome;
