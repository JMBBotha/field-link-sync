import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, FileText, BarChart3, ClipboardList, AlertTriangle, CheckCircle2, Clock, DollarSign, Users, Wrench } from "lucide-react";
import CompletedLeadsList from "@/components/admin/CompletedLeadsList";
import SyncConflictsSection from "@/components/admin/SyncConflictsSection";
import { format } from "date-fns";

interface AdminHomeProps {
  onNavigate: (tab: string) => void;
  onCreateLead: () => void;
}

const AdminHome = ({ onNavigate, onCreateLead }: AdminHomeProps) => {
  const today = new Date().toISOString().split("T")[0];

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

  const kpiCards = [
    { label: "New Leads Today", value: stats?.newLeads ?? 0, icon: Plus, color: "text-blue-500" },
    { label: "Pending Quotes", value: stats?.pendingQuotes ?? 0, icon: FileText, color: "text-orange-500" },
    { label: "Active Jobs", value: stats?.activeJobs ?? 0, icon: Clock, color: "text-green-500" },
    { label: "Overdue Invoices", value: stats?.overdueInvoices ?? 0, icon: AlertTriangle, color: "text-destructive" },
    { label: "Overdue Maintenance", value: stats?.overdueMaintenance ?? 0, icon: Wrench, color: "text-red-500" },
    { label: "Revenue Today", value: `R ${(stats?.revenueToday ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`, icon: DollarSign, color: "text-primary" },
  ];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* KPI Cards */}
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
                </CardContent>
              </Card>
            ))
          : kpiCards.map((kpi) => (
              <Card key={kpi.label}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <kpi.icon className={`h-4 w-4 ${kpi.color}`} />
                    <span className="text-xs text-muted-foreground">{kpi.label}</span>
                  </div>
                  <p className="text-2xl font-bold">{kpi.value}</p>
                </CardContent>
              </Card>
            ))}
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2">
        <Button onClick={onCreateLead}><Plus className="mr-2 h-4 w-4" />New Lead</Button>
        <Button variant="outline" onClick={() => onNavigate("quotes")}><FileText className="mr-2 h-4 w-4" />New Quote</Button>
        <Button variant="outline" onClick={() => onNavigate("analytics")}><BarChart3 className="mr-2 h-4 w-4" />Analytics</Button>
        <Button variant="outline" onClick={() => onNavigate("reports")}><ClipboardList className="mr-2 h-4 w-4" />Reports</Button>
      </div>

      {/* Completed Leads */}
      <CompletedLeadsList />

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
