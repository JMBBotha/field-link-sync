import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Plus, FileText, BarChart3, ClipboardList, AlertTriangle, CheckCircle2, Clock, DollarSign, Users, Wrench, ChevronDown, UserPlus, Loader2, UserCheck as UserCheckIcon } from "lucide-react";
import { Briefcase, UserCheck, Timer } from "lucide-react";
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import AdminAlertsPanel from "@/components/AdminAlertsPanel";
import CompletedLeadsList from "@/components/admin/CompletedLeadsList";
import SyncConflictsSection from "@/components/admin/SyncConflictsSection";
import KpiDetailDialog from "@/components/admin/KpiDetailDialog";
import QuotePerformanceWidget from "@/components/analytics/QuotePerformanceWidget";
import CreateJobDialog from "@/components/jobs/CreateJobDialog";
import { format, subDays } from "date-fns";
import { useState, useMemo } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from "recharts";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { Link, useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";


interface AdminHomeProps {
  onNavigate: (tab: string) => void;
  onCreateLead: () => void;
}

const AdminHome = ({ onNavigate, onCreateLead }: AdminHomeProps) => {
  const today = new Date().toISOString().split("T")[0];
  const [selectedKpi, setSelectedKpi] = useState<string | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [jobDialog, setJobDialog] = useState<{ open: boolean; leadId?: string; customerId?: string }>({ open: false });
  const [leadsRange, setLeadsRange] = useState<"day" | "week" | "month">("week");
  const [jobsRange, setJobsRange] = useState<"day" | "week" | "month">("day");
  const { companyId } = useUserCompanyId();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();

  const openCreateJobDialog = (leadId: string, customerId?: string | null) => {
    setJobDialog({ open: true, leadId, customerId: customerId || undefined });
  };

  const handleConvertLead = async (leadId: string, opts?: { thenCreateJob?: boolean }) => {
    setConvertingId(leadId);
    try {
      const { data, error } = await supabase.rpc("convert_lead_to_customer", { p_lead_id: leadId });
      if (error) throw error;
      toast({
        title: "Lead converted to Customer",
        description: opts?.thenCreateJob ? "Opening job details…" : "Opening customer page…",
      });
      queryClient.invalidateQueries({ queryKey: ["admin-home-stats"] });
      if (opts?.thenCreateJob) {
        openCreateJobDialog(leadId, data as string | undefined);
      } else if (data) {
        navigate(`/admin/customers/${data}`);
      }
    } catch (e: any) {
      toast({ title: "Conversion failed", description: e.message, variant: "destructive" });
    } finally {
      setConvertingId(null);
    }
  };

  const handleCreateJobFromLead = async (lead: { id: string; customer_id?: string | null }) => {
    if (lead.customer_id) {
      openCreateJobDialog(lead.id, lead.customer_id);
      return;
    }
    await handleConvertLead(lead.id, { thenCreateJob: true });
  };

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

  const leadsRangeSince = useMemo(() => {
    const days = leadsRange === "day" ? 1 : leadsRange === "week" ? 7 : 30;
    return subDays(new Date(), days - 1).toISOString().split("T")[0] + "T00:00:00";
  }, [leadsRange]);

  const jobsRangeBounds = useMemo(() => {
    const now = new Date();
    const startStr = now.toISOString().split("T")[0] + "T00:00:00";
    const endDays = jobsRange === "day" ? 1 : jobsRange === "week" ? 7 : 30;
    const end = new Date(now);
    end.setDate(end.getDate() + endDays);
    const endStr = end.toISOString().split("T")[0] + "T00:00:00";
    return { start: startStr, end: endStr };
  }, [jobsRange]);

  const { data: stats, isLoading } = useQuery({
    queryKey: ["admin-home-stats", today, leadsRange, jobsRange],
    queryFn: async () => {
      const [leadsRes, quotesRes, activeJobsRes, overdueRes, revenueRes, agentsRes, recentRes, overdueMaintenanceRes, openLeadsRes, todayJobsRes] = await Promise.all([
        supabase.from("leads").select("id", { count: "exact", head: true }).gte("created_at", today + "T00:00:00").eq("status", "pending"),
        supabase.from("quotes").select("id", { count: "exact", head: true }).eq("status", "draft"),
        supabase.from("leads").select("id", { count: "exact", head: true }).in("status", ["accepted", "en_route", "on_site"]),
        supabase.from("invoices").select("id", { count: "exact", head: true }).eq("status", "overdue"),
        supabase.from("invoices").select("grand_total").eq("status", "paid").gte("paid_date", today),
        supabase.from("profiles").select("id, full_name, availability_status").limit(20),
        supabase.from("notifications").select("id, type, title, body, created_at").order("created_at", { ascending: false }).limit(15),
        supabase.rpc("get_overdue_maintenance_count"),
        supabase.from("leads").select("id, customer_name, service_type, customer_address, status, created_at, customer_id").eq("status", "pending").gte("created_at", leadsRangeSince).order("created_at", { ascending: false }).limit(20),
        supabase.from("jobs").select("id, title, status, scheduled_for, address, customer_id").gte("scheduled_for", jobsRangeBounds.start).lt("scheduled_for", jobsRangeBounds.end).order("scheduled_for", { ascending: true }).limit(20),

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
        openLeads: (openLeadsRes.data as any[]) || [],
        todayJobs: (todayJobsRes.data as any[]) || [],
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

  // Core 5 KPIs — focused on Lead → Job → Invoice flow
  const kpiCards = useMemo(() => [
    { key: "new_leads", label: "New Leads Today", value: stats?.newLeads ?? 0, icon: Plus, color: "text-primary", sparkKey: "leads" as const, sparkColor: "#0077B6" },
    { key: "active_jobs", label: "Today's Jobs", value: stats?.activeJobs ?? 0, icon: Clock, color: "text-green-500", sparkKey: "active" as const, sparkColor: "#22c55e" },
    { key: "pending_quotes", label: "Pending Quotes", value: stats?.pendingQuotes ?? 0, icon: FileText, color: "text-orange-500", sparkKey: "leads" as const, sparkColor: "#f97316" },
    { key: "overdue_invoices", label: "Overdue Invoices", value: stats?.overdueInvoices ?? 0, icon: AlertTriangle, color: "text-destructive", sparkKey: "leads" as const, sparkColor: "#ef4444" },
    { key: "active_techs", label: "Active Techs", value: jobStats?.activeFieldAgents ?? 0, icon: UserCheck, color: "text-blue-500", sparkKey: "active" as const, sparkColor: "#3b82f6" },
  ], [stats, jobStats]);

  const [showMore, setShowMore] = useState(false);


  const activeKpi = kpiCards.find((k) => k.key === selectedKpi);

  return (
    <div className="px-3 py-4 md:p-6 space-y-4 md:space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Lead → Job → Invoice at a glance</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onCreateLead}><Plus className="mr-2 h-4 w-4" />New Lead</Button>
          <Button variant="outline" onClick={() => onNavigate("quotes")}><FileText className="mr-2 h-4 w-4" />New Quote</Button>
        </div>
      </div>

      {/* Core 5 KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 md:gap-3">


        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-4 rounded" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-6 w-full rounded" />
                </CardContent>
              </Card>
            ))

          : kpiCards.map((kpi) => (
              <Card
                key={kpi.key}
                className="cursor-pointer rounded-xl border border-border transition-all duration-200 hover:border-primary/30 hover:bg-muted/40 dark:hover:bg-[#1a2a4a]/50 hover:shadow-md"
                onClick={() => setSelectedKpi(kpi.key)}
              >
                <CardContent className="p-3 md:p-4">
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

      {/* Primary widgets — Recent Open Leads + Today's Dispatch */}
      <div className="grid md:grid-cols-2 gap-3 md:gap-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2 gap-2 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2">
              <Plus className="h-4 w-4 text-primary" /> Recent Open Leads
            </CardTitle>
            <div className="flex items-center gap-1">
              <div className="inline-flex rounded-md border border-border p-0.5 bg-muted/30">
                {(["day", "week", "month"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setLeadsRange(r)}
                    className={`text-[11px] px-2 py-0.5 rounded ${leadsRange === r ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
                  >
                    {r === "day" ? "Today" : r === "week" ? "Week" : "Month"}
                  </button>
                ))}
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/admin">View all</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 max-h-80 overflow-y-auto">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)
            ) : !stats?.openLeads?.length ? (
              <p className="text-sm text-muted-foreground text-center py-6">No open leads {leadsRange === "day" ? "today" : leadsRange === "week" ? "this week" : "this month"}</p>
            ) : (
              stats.openLeads.map((lead: any) => (
                <div key={lead.id} className="flex items-center justify-between gap-2 p-2 rounded-md border border-border/50 hover:bg-muted/50">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{lead.customer_name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {lead.service_type}{lead.customer_address ? ` · ${lead.customer_address}` : ""}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{format(new Date(lead.created_at), "dd MMM HH:mm")}</p>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <TooltipProvider delayDuration={200}>
                      {lead.customer_id ? (
                        <UITooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => navigate(`/admin/customers/${lead.customer_id}`)}
                            >
                              <UserCheckIcon className="h-3 w-3 mr-1" />View Customer
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Open the linked customer record</TooltipContent>
                        </UITooltip>
                      ) : (
                        <UITooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="default"
                              disabled={convertingId === lead.id}
                              onClick={() => handleConvertLead(lead.id)}
                            >
                              {convertingId === lead.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <><UserPlus className="h-3 w-3 mr-1" />Convert</>
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Creates or updates the matching Customer record and links this lead</TooltipContent>
                        </UITooltip>
                      )}
                    </TooltipProvider>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={convertingId === lead.id}
                      onClick={() => handleCreateJobFromLead(lead)}
                    >
                      Create Job
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2 gap-2 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-primary" /> Upcoming Jobs
            </CardTitle>
            <div className="flex items-center gap-1">
              <div className="inline-flex rounded-md border border-border p-0.5 bg-muted/30">
                {(["day", "week", "month"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setJobsRange(r)}
                    className={`text-[11px] px-2 py-0.5 rounded ${jobsRange === r ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
                  >
                    {r === "day" ? "Today" : r === "week" ? "Week" : "Month"}
                  </button>
                ))}
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/admin/jobs/dispatch">Dispatch board</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 max-h-80 overflow-y-auto">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)
            ) : !stats?.todayJobs?.length ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No jobs scheduled {jobsRange === "day" ? "today" : jobsRange === "week" ? "this week" : "this month"}
              </p>
            ) : (
              stats.todayJobs.map((job: any) => (
                <Link
                  key={job.id}
                  to={`/admin/jobs/${job.id}`}
                  className="flex items-center justify-between gap-2 p-2 rounded-md border border-border/50 hover:bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{job.title}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {job.address || "No address"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {job.scheduled_for ? format(new Date(job.scheduled_for), "dd MMM · HH:mm") : "—"}
                    </p>
                  </div>
                  <Badge variant={job.status === "in_progress" ? "default" : "secondary"} className="shrink-0">
                    {(job.status || "pending").replace(/_/g, " ")}
                  </Badge>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

      </div>

      {/* Secondary insights — collapsible */}
      <Collapsible open={showMore} onOpenChange={setShowMore}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full justify-between">
            <span className="flex items-center gap-2 text-sm font-medium">
              <BarChart3 className="h-4 w-4" />
              More insights
            </span>
            <ChevronDown className={`h-4 w-4 transition-transform ${showMore ? "rotate-180" : ""}`} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-6 pt-4">
          {/* Secondary KPIs */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card className="rounded-xl border border-border">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <DollarSign className="h-4 w-4 text-primary" />
                    <span className="text-xs text-muted-foreground">Revenue Today</span>
                  </div>
                  <p className="text-2xl font-bold">R {(stats.revenueToday ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</p>
                </CardContent>
              </Card>
              <Card className="rounded-xl border border-border">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Wrench className="h-4 w-4 text-destructive" />
                    <span className="text-xs text-muted-foreground">Overdue Maintenance</span>
                  </div>
                  <p className="text-2xl font-bold">{stats.overdueMaintenance ?? 0}</p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Jobs & Dispatch overview */}
          {jobStats && (
            <div>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2 text-muted-foreground">
                <Briefcase className="h-4 w-4" /> Jobs & Dispatch
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { label: "Total Jobs", value: jobStats.totalJobs, icon: Briefcase, to: "/admin/jobs/dispatch" },
                  { label: "Active Jobs", value: jobStats.activeJobs, icon: Clock, to: "/admin/jobs/dispatch" },
                  { label: "Completed", value: jobStats.completedJobs, icon: CheckCircle2, to: "/admin/jobs/dispatch" },
                  { label: "Pending Assign.", value: jobStats.pendingAssignments, icon: ClipboardList, to: "/admin/dispatch" },
                  { label: "Active Agents", value: jobStats.activeFieldAgents, icon: UserCheck, to: "/admin/team" },
                  { label: "Avg Completion", value: `${jobStats.avgCompletionDays}d`, icon: Timer, to: "/admin/analytics" },
                ].map((card) => (
                  <Link key={card.label} to={card.to} className="block focus:outline-none focus:ring-2 focus:ring-primary rounded-xl">
                    <Card className="rounded-xl border border-border cursor-pointer hover:border-primary/30 hover:bg-muted/40 transition-colors">
                      <CardContent className="p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <card.icon className="h-4 w-4 text-primary" />
                          <span className="text-xs text-muted-foreground truncate">{card.label}</span>
                        </div>
                        <p className="text-xl font-bold">{card.value}</p>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Jobs by Status Chart */}
          {jobStats && jobStats.statusBreakdown.length > 0 && (
            <Card className="rounded-xl border border-border">
              <CardHeader className="pb-2"><CardTitle className="text-base">Jobs by Status</CardTitle></CardHeader>
              <CardContent>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={jobStats.statusBreakdown} layout="vertical" margin={{ left: 80 }}>
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                      <YAxis type="category" dataKey="status" tick={{ fontSize: 12 }}
                        tickFormatter={(v: string) => v.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())} />
                      <Tooltip formatter={(value: number) => [value, "Jobs"]}
                        labelFormatter={(v: string) => v.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())} />
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

          <QuotePerformanceWidget />
          <CompletedLeadsList />
          <AdminAlertsPanel />
          <SyncConflictsSection />
        </CollapsibleContent>
      </Collapsible>

      <CreateJobDialog
        open={jobDialog.open}
        onOpenChange={(o) => setJobDialog((s) => ({ ...s, open: o }))}
        defaultLeadId={jobDialog.leadId}
        defaultCustomerId={jobDialog.customerId}
      />
    </div>
  );
};

export default AdminHome;

