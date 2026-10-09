import { useQuery, useQueryClient } from "@tanstack/react-query";
import JobCard from "@/components/cards/JobCard";
import { jobToCard } from "@/lib/cardModel";
import LeadCardV2 from "@/components/leads/LeadCardV2";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Plus, FileText, BarChart3, ClipboardList, AlertTriangle, CheckCircle2, Clock, Users, Wrench, ChevronDown, UserPlus, Loader2, UserCheck as UserCheckIcon } from "lucide-react";
import RandSign from "@/components/icons/RandSign";
import { Briefcase, UserCheck, Timer } from "lucide-react";
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import AdminAlertsPanel from "@/components/AdminAlertsPanel";
import MoneySummaryCard from "@/components/admin/MoneySummaryCard";
import CompletedLeadsList from "@/components/admin/CompletedLeadsList";
import ReadyToInvoiceCard from "@/components/admin/ReadyToInvoiceCard";
import SyncConflictsSection from "@/components/admin/SyncConflictsSection";
import AdminMapPage from "@/pages/admin/AdminMapPage";
import KpiHoverPreview from "@/components/admin/KpiHoverPreview";
import { useLeadInbox, INBOX_ROUTE } from "@/hooks/useLeadInbox";
import QuotePerformanceWidget from "@/components/analytics/QuotePerformanceWidget";
import PipelineMetrics from "@/components/analytics/PipelineMetrics";
import QuickTemplateDialog from "@/components/quoting/QuickTemplateDialog";
import { Sparkles } from "lucide-react";
import CreateJobDialog from "@/components/jobs/CreateJobDialog";
import { format, subDays } from "date-fns";
import { useState, useMemo } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from "recharts";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { Link, useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { useSalesRep } from "@/hooks/useSalesRep";
import MyAppointmentsCard from "@/components/admin/MyAppointmentsCard";
import LeadOfferFlagsCard from "@/components/admin/LeadOfferFlagsCard";
import { fetchTodaysJobs, fetchOverdue, todayInJohannesburg, loadEntries } from "@/lib/todaysJobs";
import { buildBoardRows } from "@/lib/jobsBoard";
import { fetchMoneySummary } from "@/lib/moneySummary";
import { TILE_LINKS, filterQuoteDocs, filterInvoices, PENDING_QUOTES_FILTER, OVERDUE_INVOICES_FILTER, REVENUE_TODAY_FILTER, D1_TILE_LINKS, filterVisitsBooked, filterLeadsByLane } from "@/lib/drilldown";
import { CalendarCheck, Wallet } from "lucide-react";
import { fetchOverdueMaintenanceCount } from "@/lib/maintenanceMetrics";


const kpiViewAllHref: Record<string, string> = {
  new_leads: "/admin/dispatch?inbox=1",
  active_jobs: TILE_LINKS.todaysJobs,
  pending_quotes: TILE_LINKS.pendingQuotes,
  overdue_invoices: TILE_LINKS.overdueInvoices,
  active_techs: TILE_LINKS.activeTechs,
  visits_booked: D1_TILE_LINKS.visitsBooked,
  service_leads: D1_TILE_LINKS.serviceLeads,
  deposits_due: D1_TILE_LINKS.depositsDue,
};
const NO_PREVIEW = new Set(["visits_booked", "service_leads", "deposits_due"]);

interface AdminHomeProps {
  onNavigate: (tab: string) => void;
  onCreateLead: () => void;
}

const AdminHome = ({ onNavigate, onCreateLead }: AdminHomeProps) => {
  const today = todayInJohannesburg();
  const { count: inboxCount, leads: inboxLeads } = useLeadInbox();
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [jobDialog, setJobDialog] = useState<{ open: boolean; leadId?: string; customerId?: string }>({ open: false });
  const [leadsRange, setLeadsRange] = useState<"day" | "week" | "month">("week");
  const [jobsRange, setJobsRange] = useState<"day" | "week" | "month">("day");
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
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
        supabase.from("leads").select("id", { count: "exact", head: true }).gte("created_at", today + "T00:00:00+02:00").eq("status", "pending"),
        supabase.from("quotes").select("id, status, created_at").eq("status", "draft"),
        Promise.all([fetchTodaysJobs(), fetchOverdue()]).catch(() => null),
        supabase.from("invoices").select("id, status, issue_date, paid_date").eq("status", "overdue"),
        supabase.from("invoices").select("grand_total, status, issue_date, paid_date").eq("status", "paid").gte("paid_date", today),
        supabase.from("profiles").select("id, full_name, availability_status").limit(20),
        supabase.from("notifications").select("id, type, title, body, created_at").order("created_at", { ascending: false }).limit(15),
        fetchOverdueMaintenanceCount(),
        supabase.from("leads").select("*").eq("status", "pending").gte("created_at", leadsRangeSince).order("created_at", { ascending: false }).limit(20),
        supabase.from("jobs").select("id, title, status, scheduled_for, address, customer_id").gte("scheduled_for", jobsRangeBounds.start).lt("scheduled_for", jobsRangeBounds.end).order("scheduled_for", { ascending: true }).limit(20),

      ]);

      // Tile numbers use the SAME filters as the lists they link to.
      const pendingQuotes = filterQuoteDocs(((quotesRes.data as any[]) || []).map((q) => ({ ...q, kind: "estimate" as const })), PENDING_QUOTES_FILTER).length;
      const overdueInvoices = filterInvoices((overdueRes.data as any[]) || [], OVERDUE_INVOICES_FILTER).length;
      const revenueToday = filterInvoices((revenueRes.data as any[]) || [], REVENUE_TODAY_FILTER).reduce((sum, inv) => sum + Number(inv.grand_total || 0), 0) || 0;

      return {
        newLeads: leadsRes.count || 0,
        pendingQuotes,
        activeJobs: activeJobsRes?.[0].open.length ?? 0,
        todayDone: activeJobsRes?.[0].completed ?? 0,
        todayTotal: activeJobsRes?.[0].total ?? 0,
        overdueJobs: activeJobsRes?.[1].length ?? 0,
        overdueInvoices,
        overdueMaintenance: overdueMaintenanceRes,
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

  // Release D1 tiles — each number uses the same pure filter as its list.
  const { data: d1 } = useQuery({
    queryKey: ["admin-home-d1", today, companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const [jobsRes, entries, money] = await Promise.all([
        supabase.from("jobs").select("id, status, scheduled_for, job_type, title, address, assignments(id, profile_id, status)"),
        loadEntries({}).catch(() => []),
        fetchMoneySummary(companyId as string).catch(() => null),
      ]);
      return {
        visitsBooked: filterVisitsBooked(buildBoardRows((jobsRes.data as any[]) || [], entries)).length,
        depositsDue: money?.depositsDue.count ?? 0,
      };
    },
    refetchInterval: 60000,
  });
  const serviceLeads = useMemo(() => filterLeadsByLane(inboxLeads as any[], "service").length, [inboxLeads]);

  // Core 5 KPIs — focused on Lead → Job → Invoice flow
  const { isSalesRep } = useSalesRep();
  const kpiCardsAll = useMemo(() => [
    { key: "new_leads", label: "New Leads", value: inboxCount, icon: Plus, color: "text-primary", sparkKey: "leads" as const, sparkColor: "#0077B6" },
    { key: "active_jobs", label: "Today's Jobs", value: stats?.activeJobs ?? 0, icon: Clock, color: "text-green-500", sparkKey: "active" as const, sparkColor: "#22c55e" },
    { key: "pending_quotes", label: "Pending Quotes", value: stats?.pendingQuotes ?? 0, icon: FileText, color: "text-orange-500", sparkKey: "leads" as const, sparkColor: "#f97316" },
    { key: "overdue_invoices", label: "Overdue Invoices", value: stats?.overdueInvoices ?? 0, icon: AlertTriangle, color: "text-destructive", sparkKey: "leads" as const, sparkColor: "#ef4444" },
    { key: "active_techs", label: "Active Techs", value: jobStats?.activeFieldAgents ?? 0, icon: UserCheck, color: "text-blue-500", sparkKey: "active" as const, sparkColor: "#3b82f6" },
    { key: "visits_booked", label: "Visits booked", value: d1?.visitsBooked ?? 0, icon: CalendarCheck, color: "text-primary", sparkKey: "active" as const, sparkColor: "#0077B6" },
    { key: "service_leads", label: "Service leads", value: serviceLeads, icon: Wrench, color: "text-green-500", sparkKey: "leads" as const, sparkColor: "#22c55e" },
    { key: "deposits_due", label: "Installs awaiting deposit", value: d1?.depositsDue ?? 0, icon: Wallet, color: "text-orange-500", sparkKey: "leads" as const, sparkColor: "#f97316" },
  ], [stats, jobStats, inboxCount, d1, serviceLeads]);
  const SALES_REP_HIDDEN_KPIS = ["overdue_invoices", "active_techs", "deposits_due"];
  const kpiCards = useMemo(
    () => (isSalesRep ? kpiCardsAll.filter((k) => !SALES_REP_HIDDEN_KPIS.includes(k.key)) : kpiCardsAll),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kpiCardsAll, isSalesRep],
  );

  const [showMore, setShowMore] = useState(false);


  const getCompactStatus = (status?: string | null) => {
    const normalized = status || "pending";
    const labels: Record<string, string> = {
      pending: "Pending",
      scheduled: "Sched",
      dispatched: "Sent",
      in_progress: "Active",
      completed: "Done",
      cancelled: "Cancel",
    };
    return labels[normalized] || normalized.replace(/_/g, " ");
  };

  return (
    <div className="w-full max-w-7xl overflow-x-hidden px-3 py-4 md:p-6 pb-32 md:pb-32 lg:pb-8 space-y-4 md:space-y-5 mx-auto">
      {/* Header */}
      <div className="flex items-center justify-start md:justify-between flex-wrap gap-3">
        <div>
          <h1 className="hidden md:block text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="hidden md:block text-sm text-muted-foreground">Lead → Job → Invoice at a glance</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="brand" onClick={onCreateLead}><Plus className="mr-2 h-4 w-4" />New Lead</Button>
          <Button variant="brand" onClick={() => onNavigate("quotes")}><Plus className="mr-2 h-4 w-4" />New Quote</Button>
          
        </div>
      </div>

      <QuickTemplateDialog
        open={showTemplatePicker}
        onClose={() => setShowTemplatePicker(false)}
      />

      {/* Rep: own upcoming appointments (STEP 3) */}
      {isSalesRep && <MyAppointmentsCard limit={5} />}

      {!isSalesRep && <LeadOfferFlagsCard />}
      {!isSalesRep && <ReadyToInvoiceCard />}

      {/* Core 5 KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">


        {isLoading
          ? Array.from({ length: 8 }).map((_, i) => (
              <Card key={i} className="surface-card">
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
              <KpiHoverPreview
                key={kpi.key}
                kpiKey={kpi.key}
                label={kpi.label}
                viewAllHref={kpiViewAllHref[kpi.key] || "/admin"}
                disabled={NO_PREVIEW.has(kpi.key)}
              >
              <Card
                className="surface-card surface-card-interactive cursor-pointer"
                role="link"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter") navigate(kpiViewAllHref[kpi.key] || "/admin"); }}
                onClick={() => navigate(kpi.key === "new_leads" ? INBOX_ROUTE : kpiViewAllHref[kpi.key] || "/admin")}
              >
                <CardContent className="p-3 md:p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <kpi.icon className={`h-4 w-4 ${kpi.color}`} />
                    <span className="text-xs text-muted-foreground">{kpi.label}</span>
                  </div>
                  <p className="text-2xl font-bold">{kpi.value}</p>
                  {kpi.key === "active_jobs" && stats && (
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      {stats.todayTotal > 0 && <span>{stats.todayDone}/{stats.todayTotal} done</span>}
                      {stats.overdueJobs > 0 && (
                        <Link
                          to="/admin/schedule"
                          onClick={(e) => e.stopPropagation()}
                          className="text-destructive font-medium hover:underline"
                        >
                          Overdue {stats.overdueJobs}
                        </Link>
                      )}
                    </div>
                  )}
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
              </KpiHoverPreview>
            ))}
      </div>

      {/* Pipeline health metrics — 90-day window */}
      <PipelineMetrics />

      {/* Primary widgets — Recent Open Leads + Today's Dispatch */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-6 min-w-0">
        <Card className="surface-card min-w-0 overflow-hidden">

          <CardHeader className="min-w-0 space-y-2 pb-2 p-3 md:p-6">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <CardTitle className="text-sm md:text-base flex items-center gap-2 min-w-0 truncate">
                <Plus className="h-4 w-4 text-primary" /> Open Leads
              </CardTitle>
              <Button variant="ghost" size="sm" asChild className="h-7 shrink-0 px-2 text-xs">
                <Link to={INBOX_ROUTE}>View all</Link>
              </Button>
            </div>
            <div className="surface-segment grid w-full grid-cols-3 p-0.5 md:inline-flex md:w-auto md:self-start">
              {(["day", "week", "month"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setLeadsRange(r)}
                  data-active={leadsRange === r}
                  className="surface-segment-item min-w-0 text-[11px] px-1.5 py-0.5"
                >
                  {r === "day" ? "Today" : r === "week" ? "Week" : "Month"}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="min-w-0 space-y-2 max-h-80 overflow-y-auto overflow-x-hidden p-3 pt-0 md:p-6 md:pt-0">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)
            ) : !stats?.openLeads?.length ? (
              <p className="text-sm text-muted-foreground text-center py-6">No open leads {leadsRange === "day" ? "today" : leadsRange === "week" ? "this week" : "this month"}</p>
            ) : (
              stats.openLeads.map((lead: any) => (
                <LeadCardV2 key={lead.id} lead={lead} onOpen={() => navigate(`/admin/dispatch?lead=${lead.id}`)} extra={
                   <div className="flex items-center gap-1 shrink-0">
                    {lead.customer_id ? (
                      <Button
                        size="icon"
                        variant="default"
                        className="h-7 w-7 md:h-8 md:w-8"
                        title="View Customer"
                        onClick={() => navigate(`/admin/customers/${lead.customer_id}`)}
                      >
                        <UserCheckIcon className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button
                        size="icon"
                        variant="default"
                        className="h-7 w-7 md:h-8 md:w-8"
                        title="Convert to Customer"
                        disabled={convertingId === lead.id}
                        onClick={() => handleConvertLead(lead.id)}
                      >
                        {convertingId === lead.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-7 w-7 md:h-8 md:w-8"
                      title="Create Job"
                      disabled={convertingId === lead.id}
                      onClick={() => handleCreateJobFromLead(lead)}
                    >
                      <Briefcase className="h-4 w-4" />
                    </Button>
                  </div>
                } />
              ))
            )}
          </CardContent>
        </Card>

        <Card className="surface-card min-w-0 overflow-hidden">
          <CardHeader className="min-w-0 space-y-2 pb-2 p-3 md:p-6">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <CardTitle className="text-sm md:text-base flex items-center gap-2 min-w-0 truncate">
                <Briefcase className="h-4 w-4 text-primary" /> Upcoming Jobs
              </CardTitle>
              {!isSalesRep && (
                <Button variant="ghost" size="sm" asChild className="h-7 shrink-0 px-2 text-xs">
                  <Link to="/admin/jobs?tab=dispatch&view=board">Dispatch</Link>
                </Button>
              )}
            </div>
            <div className="surface-segment grid w-full grid-cols-3 p-0.5 md:inline-flex md:w-auto md:self-start">
              {(["day", "week", "month"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setJobsRange(r)}
                  data-active={jobsRange === r}
                  className="surface-segment-item min-w-0 text-[11px] px-1.5 py-0.5"
                >
                  {r === "day" ? "Today" : r === "week" ? "Week" : "Month"}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="min-w-0 space-y-2 max-h-80 overflow-y-auto overflow-x-hidden p-3 pt-0 md:p-6 md:pt-0">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)
            ) : !stats?.todayJobs?.length ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No jobs scheduled {jobsRange === "day" ? "today" : jobsRange === "week" ? "this week" : "this month"}
              </p>
            ) : (
              stats.todayJobs.map((job: any) => (
                <JobCard key={job.id} item={jobToCard(job)} density="compact" audience={isSalesRep ? "sales" : "office"}
                  onOpen={() => navigate(`/admin/jobs/${job.id}`)} />
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
              {!isSalesRep && <Card className="surface-card surface-card-interactive cursor-pointer" role="link" tabIndex={0} onClick={() => navigate(TILE_LINKS.revenueToday)} onKeyDown={(e) => { if (e.key === "Enter") navigate(TILE_LINKS.revenueToday); }}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <RandSign className="h-4 w-4 text-primary" />
                    <span className="text-xs text-muted-foreground">Revenue Today</span>
                  </div>
                  <p className="text-2xl font-bold">R {(stats.revenueToday ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</p>
                </CardContent>
              </Card>}
              <Card className="surface-card surface-card-interactive cursor-pointer" role="link" tabIndex={0} onClick={() => navigate(TILE_LINKS.overdueMaintenance)} onKeyDown={(e) => { if (e.key === "Enter") navigate(TILE_LINKS.overdueMaintenance); }}>
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
          {jobStats && !isSalesRep && (
            <div>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2 text-muted-foreground">
                <Briefcase className="h-4 w-4" /> Jobs & Dispatch
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { label: "Total Jobs", value: jobStats.totalJobs, icon: Briefcase, to: TILE_LINKS.jobsTotal },
                  { label: "Active Jobs", value: jobStats.activeJobs, icon: Clock, to: TILE_LINKS.jobsActive },
                  { label: "Completed", value: jobStats.completedJobs, icon: CheckCircle2, to: TILE_LINKS.jobsCompleted },
                  { label: "Pending Assign.", value: jobStats.pendingAssignments, icon: ClipboardList, to: "/admin/dispatch" },
                  { label: "Active Agents", value: jobStats.activeFieldAgents, icon: UserCheck, to: "/admin/team" },
                  { label: "Avg Completion", value: `${jobStats.avgCompletionDays}d`, icon: Timer, to: "/admin/analytics" },
                ].map((card) => (
                  <Link key={card.label} to={card.to} className="block focus:outline-none focus:ring-2 focus:ring-primary rounded-xl">
                    <Card className="surface-card surface-card-interactive cursor-pointer">
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

          {/* Live Map — same view as the sidebar "Map" page */}
          {!isSalesRep && (
            <Card className="surface-card-solid overflow-hidden">
              <div className="relative w-full h-[70vh] min-h-[480px]">
                <AdminMapPage />
              </div>
            </Card>
          )}

          {!isSalesRep && <MoneySummaryCard />}
          {!isSalesRep && <QuotePerformanceWidget />}
          {!isSalesRep && <CompletedLeadsList />}
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

