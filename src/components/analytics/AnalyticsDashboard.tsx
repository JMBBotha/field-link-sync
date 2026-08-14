import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { format, subDays, startOfWeek, startOfMonth, endOfDay, differenceInMinutes } from "date-fns";
import { Briefcase, Clock, Users, FileCheck, CalendarDays, Download, TrendingUp, Award, Filter, Wrench, AlertTriangle, Percent, FileText } from "lucide-react";
import RandSign from "@/components/icons/RandSign";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend,
} from "recharts";
import KPICard from "./KPICard";
import { exportToCSV } from "@/lib/csvExport";
import { fetchOverdueMaintenanceCount } from "@/lib/maintenanceMetrics";
import jsPDF from "jspdf";

type DatePreset = "this_week" | "this_month" | "last_30" | "custom";

const CHART_COLORS = [
  "hsl(204, 100%, 36%)",
  "hsl(142, 76%, 36%)",
  "hsl(38, 92%, 50%)",
  "hsl(0, 84%, 60%)",
  "hsl(262, 80%, 50%)",
  "hsl(180, 70%, 40%)",
];

const FUNNEL_COLORS: Record<string, string> = {
  pending: "hsl(220, 9%, 46%)",
  accepted: "hsl(204, 100%, 36%)",
  en_route: "hsl(38, 92%, 50%)",
  on_site: "hsl(262, 80%, 50%)",
  completed: "hsl(142, 76%, 36%)",
};

const AnalyticsDashboard = () => {
  const [datePreset, setDatePreset] = useState<DatePreset>("last_30");
  const [customFrom, setCustomFrom] = useState<Date>();
  const [customTo, setCustomTo] = useState<Date>();
  const [agentFilter, setAgentFilter] = useState("all");
  const [jobTypeFilter, setJobTypeFilter] = useState("all");

  const dateRange = useMemo(() => {
    const now = new Date();
    switch (datePreset) {
      case "this_week": return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfDay(now) };
      case "this_month": return { from: startOfMonth(now), to: endOfDay(now) };
      case "last_30": return { from: subDays(now, 30), to: endOfDay(now) };
      case "custom": return { from: customFrom || subDays(now, 30), to: customTo || endOfDay(now) };
    }
  }, [datePreset, customFrom, customTo]);

  const fromISO = dateRange.from.toISOString();
  const toISO = dateRange.to.toISOString();

  // Agents list for filter
  const { data: agents = [] } = useQuery({
    queryKey: ["analytics-agents"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name").order("full_name");
      return data || [];
    },
  });

  // Revenue metrics
  const { data: revenueMetrics } = useQuery({
    queryKey: ["analytics-revenue", fromISO, toISO, agentFilter],
    queryFn: async () => {
      let invoicedQ = supabase.from("invoices").select("grand_total, status, agent_id")
        .gte("created_at", fromISO).lte("created_at", toISO);
      if (agentFilter !== "all") invoicedQ = invoicedQ.eq("agent_id", agentFilter);
      const { data: invoices } = await invoicedQ;

      const totalInvoiced = invoices?.reduce((s, i) => s + Number(i.grand_total), 0) || 0;
      const totalPaid = invoices?.filter(i => i.status === "paid").reduce((s, i) => s + Number(i.grand_total), 0) || 0;
      return { totalInvoiced, totalPaid };
    },
  });

  // Completed jobs
  const { data: completedJobs } = useQuery({
    queryKey: ["analytics-completed-jobs", fromISO, toISO, agentFilter, jobTypeFilter],
    queryFn: async () => {
      let q = supabase.from("leads").select("id, assigned_agent_id, service_type, completed_at, started_at, created_at")
        .eq("status", "completed")
        .gte("completed_at", fromISO).lte("completed_at", toISO);
      if (agentFilter !== "all") q = q.eq("assigned_agent_id", agentFilter);
      if (jobTypeFilter !== "all") q = q.ilike("service_type", `%${jobTypeFilter}%`);
      const { data } = await q;
      return data || [];
    },
  });

  // Lead funnel counts
  const { data: leadFunnel = [] } = useQuery({
    queryKey: ["analytics-lead-funnel", fromISO, toISO],
    queryFn: async () => {
      const statuses = ["pending", "accepted", "en_route", "on_site", "completed"];
      const results = await Promise.all(
        statuses.map(async (status) => {
          const { count } = await supabase.from("leads").select("*", { count: "exact", head: true })
            .eq("status", status).gte("created_at", fromISO).lte("created_at", toISO);
          return { status, count: count || 0 };
        })
      );
      return results;
    },
  });

  // Service agreements
  const { data: agreementMetrics } = useQuery({
    queryKey: ["analytics-agreements"],
    queryFn: async () => {
      const { count: active } = await supabase.from("service_agreements").select("*", { count: "exact", head: true }).eq("status", "active");
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);
      const { count: upcoming } = await supabase.from("service_agreements").select("*", { count: "exact", head: true })
        .eq("status", "active").lte("next_service_due", nextWeek.toISOString().split("T")[0]).gte("next_service_due", new Date().toISOString().split("T")[0]);
      return { active: active || 0, upcoming: upcoming || 0 };
    },
  });

  // Maintenance metrics
  const { data: maintenanceMetrics } = useQuery({
    queryKey: ["analytics-maintenance"],
    queryFn: async () => {
      const [totalRes, completedRes, overdueCount, revenueRes] = await Promise.all([
        supabase.from("maintenance_schedules").select("id", { count: "exact", head: true }),
        supabase.from("maintenance_schedules").select("id", { count: "exact", head: true }).eq("status", "completed"),
        fetchOverdueMaintenanceCount(),
        supabase.from("service_agreements").select("price").eq("status", "active"),
      ]);
      const total = totalRes.count || 0;
      const completed = completedRes.count || 0;
      const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
      const recurringRevenue = revenueRes.data?.reduce((s, a) => s + Number(a.price), 0) || 0;
      return { completionRate, overdue: overdueCount, recurringRevenue };
    },
  });

  // Daily revenue chart
  const { data: dailyRevenue = [] } = useQuery({
    queryKey: ["analytics-daily-revenue", fromISO, toISO, agentFilter],
    queryFn: async () => {
      let q = supabase.from("invoices").select("grand_total, created_at, status")
        .gte("created_at", fromISO).lte("created_at", toISO);
      if (agentFilter !== "all") q = q.eq("agent_id", agentFilter);
      const { data } = await q;
      if (!data) return [];

      const byDay: Record<string, number> = {};
      data.forEach(inv => {
        const day = format(new Date(inv.created_at), "MMM dd");
        byDay[day] = (byDay[day] || 0) + Number(inv.grand_total);
      });
      return Object.entries(byDay).map(([day, revenue]) => ({ day, revenue }));
    },
  });

  // Daily jobs chart
  const { data: dailyJobs = [] } = useQuery({
    queryKey: ["analytics-daily-jobs", fromISO, toISO, agentFilter],
    queryFn: async () => {
      let q = supabase.from("leads").select("completed_at")
        .eq("status", "completed").gte("completed_at", fromISO).lte("completed_at", toISO);
      if (agentFilter !== "all") q = q.eq("assigned_agent_id", agentFilter);
      const { data } = await q;
      if (!data) return [];

      const byDay: Record<string, number> = {};
      data.forEach(lead => {
        if (lead.completed_at) {
          const day = format(new Date(lead.completed_at), "MMM dd");
          byDay[day] = (byDay[day] || 0) + 1;
        }
      });
      return Object.entries(byDay).map(([day, jobs]) => ({ day, jobs }));
    },
  });

  // Top agents
  const { data: topAgents = [] } = useQuery({
    queryKey: ["analytics-top-agents", fromISO, toISO],
    queryFn: async () => {
      const { data } = await supabase.rpc("agent_performance_scores");
      return (data as any[]) || [];
    },
  });

  // Computed KPIs
  const jobCount = completedJobs?.length || 0;
  const avgDurationMins = useMemo(() => {
    if (!completedJobs?.length) return 0;
    const withDuration = completedJobs.filter(j => j.started_at && j.completed_at);
    if (!withDuration.length) return 0;
    const total = withDuration.reduce((sum, j) => sum + differenceInMinutes(new Date(j.completed_at!), new Date(j.started_at!)), 0);
    return Math.round(total / withDuration.length);
  }, [completedJobs]);

  const avgDurationHrs = (avgDurationMins / 60).toFixed(1);

  // Jobs by agent breakdown
  const jobsByAgent = useMemo(() => {
    if (!completedJobs?.length) return [];
    const map: Record<string, number> = {};
    completedJobs.forEach(j => {
      const agentName = agents.find(a => a.id === j.assigned_agent_id)?.full_name || "Unassigned";
      map[agentName] = (map[agentName] || 0) + 1;
    });
    return Object.entries(map).map(([agent, count]) => ({ agent, count })).sort((a, b) => b.count - a.count);
  }, [completedJobs, agents]);

  // CSV export
  const handleExport = () => {
    const rows = (completedJobs || []).map(j => ({
      job_id: j.id,
      service_type: j.service_type,
      agent: agents.find(a => a.id === j.assigned_agent_id)?.full_name || "Unknown",
      completed_at: j.completed_at ? format(new Date(j.completed_at), "yyyy-MM-dd HH:mm") : "",
      duration_mins: j.started_at && j.completed_at ? differenceInMinutes(new Date(j.completed_at), new Date(j.started_at)) : "",
    }));
    exportToCSV(rows, `analytics-export-${format(new Date(), "yyyy-MM-dd")}`);
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header + Filters */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Business Analytics</h1>
            <p className="text-sm text-muted-foreground">Key metrics for HVAC business owners</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" />CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => {
              const doc = new jsPDF();
              doc.setFontSize(16);
              doc.text("Analytics Report", 14, 20);
              doc.setFontSize(9);
              doc.text(`Period: ${format(dateRange.from, "dd MMM yyyy")} - ${format(dateRange.to, "dd MMM yyyy")}`, 14, 28);
              doc.text(`Total Jobs: ${completedJobs.length} | Revenue: R ${(revenueMetrics?.totalPaid || 0).toLocaleString("en-ZA")}`, 14, 34);
              let y = 44;
              doc.setFontSize(8);
              doc.setFont("helvetica", "bold");
              doc.text("Service", 14, y); doc.text("Agent", 70, y); doc.text("Completed", 130, y); doc.text("Duration", 170, y);
              y += 6;
              doc.setFont("helvetica", "normal");
              (completedJobs || []).slice(0, 100).forEach(j => {
                if (y > 280) { doc.addPage(); y = 20; }
                doc.text(j.service_type?.slice(0, 28) || "", 14, y);
                doc.text(agents.find(a => a.id === j.assigned_agent_id)?.full_name?.slice(0, 28) || "—", 70, y);
                doc.text(j.completed_at ? format(new Date(j.completed_at), "dd MMM yy") : "", 130, y);
                const dur = j.started_at && j.completed_at ? differenceInMinutes(new Date(j.completed_at), new Date(j.started_at)) : null;
                doc.text(dur != null ? `${dur} min` : "—", 170, y);
                y += 5;
              });
              doc.save(`analytics-${format(new Date(), "yyyy-MM-dd")}.pdf`);
            }}>
              <FileText className="mr-2 h-4 w-4" />PDF
            </Button>
          </div>
        </div>

        {/* Filters row */}
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />

          {/* Date preset */}
          <Select value={datePreset} onValueChange={(v) => setDatePreset(v as DatePreset)}>
            <SelectTrigger className="w-[150px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="this_week">This Week</SelectItem>
              <SelectItem value="this_month">This Month</SelectItem>
              <SelectItem value="last_30">Last 30 Days</SelectItem>
              <SelectItem value="custom">Custom Range</SelectItem>
            </SelectContent>
          </Select>

          {datePreset === "custom" && (
            <div className="flex gap-1">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className={cn("text-xs", !customFrom && "text-muted-foreground")}>
                    <CalendarDays className="mr-1 h-3 w-3" />
                    {customFrom ? format(customFrom, "dd MMM") : "From"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={customFrom} onSelect={setCustomFrom} className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className={cn("text-xs", !customTo && "text-muted-foreground")}>
                    <CalendarDays className="mr-1 h-3 w-3" />
                    {customTo ? format(customTo, "dd MMM") : "To"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={customTo} onSelect={setCustomTo} className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
          )}

          {/* Agent filter */}
          <Select value={agentFilter} onValueChange={setAgentFilter}>
            <SelectTrigger className="w-[150px] h-9">
              <SelectValue placeholder="All Agents" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Agents</SelectItem>
              {agents.map(a => (
                <SelectItem key={a.id} value={a.id}>{a.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Job type filter */}
          <Select value={jobTypeFilter} onValueChange={setJobTypeFilter}>
            <SelectTrigger className="w-[140px] h-9">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="sales">Sales</SelectItem>
              <SelectItem value="technical">Technical</SelectItem>
              <SelectItem value="maintenance">Maintenance</SelectItem>
              <SelectItem value="installation">Installation</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-9 gap-3">
        <KPICard label="Invoiced" value={revenueMetrics?.totalInvoiced || 0} prefix="R" icon={RandSign}
          gradient="linear-gradient(135deg, hsl(204, 100%, 30%) 0%, hsl(204, 100%, 42%) 100%)" />
        <KPICard label="Paid" value={revenueMetrics?.totalPaid || 0} prefix="R" icon={RandSign}
          gradient="linear-gradient(135deg, hsl(142, 76%, 30%) 0%, hsl(142, 76%, 40%) 100%)" />
        <KPICard label="Jobs Done" value={jobCount} icon={Briefcase}
          gradient="linear-gradient(135deg, hsl(38, 92%, 40%) 0%, hsl(38, 92%, 54%) 100%)" />
        <KPICard label="Avg Duration" value={Number(avgDurationHrs)} suffix=" hrs" icon={Clock} decimals={1}
          gradient="linear-gradient(135deg, hsl(262, 80%, 40%) 0%, hsl(262, 80%, 55%) 100%)" />
        <KPICard label="Agreements" value={agreementMetrics?.active || 0} icon={FileCheck}
          suffix={agreementMetrics?.upcoming ? ` (${agreementMetrics.upcoming} due)` : ""}
          gradient="linear-gradient(135deg, hsl(180, 70%, 30%) 0%, hsl(180, 70%, 44%) 100%)" />
        <KPICard label="Open Leads" value={leadFunnel.find(l => l.status === "pending")?.count || 0} icon={Users}
          gradient="linear-gradient(135deg, hsl(0, 84%, 50%) 0%, hsl(0, 84%, 64%) 100%)" />
        <KPICard label="Maint. Rate" value={maintenanceMetrics?.completionRate || 0} suffix="%" icon={Percent}
          gradient="linear-gradient(135deg, hsl(160, 70%, 30%) 0%, hsl(160, 70%, 44%) 100%)" />
        <KPICard label="Recurring Rev." value={maintenanceMetrics?.recurringRevenue || 0} prefix="R" icon={Wrench}
          gradient="linear-gradient(135deg, hsl(280, 60%, 35%) 0%, hsl(280, 60%, 50%) 100%)" />
        <KPICard label="Overdue Maint." value={maintenanceMetrics?.overdue || 0} icon={AlertTriangle}
          gradient="linear-gradient(135deg, hsl(0, 70%, 40%) 0%, hsl(0, 70%, 55%) 100%)" />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Revenue over time */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />Revenue Over Time
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailyRevenue}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                  <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground"
                    tickFormatter={(v) => `R${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} />
                  <Tooltip formatter={(v: number) => [`R${v.toLocaleString("en-ZA")}`, "Revenue"]}
                    contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))", background: "hsl(var(--background))" }} />
                  <Line type="monotone" dataKey="revenue" stroke="hsl(204, 100%, 36%)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Jobs per day */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-primary" />Jobs Completed Per Day
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyJobs}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                  <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))", background: "hsl(var(--background))" }} />
                  <Bar dataKey="jobs" fill="hsl(142, 76%, 36%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Lead Funnel */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Lead Conversion Funnel</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={leadFunnel} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" tick={{ fontSize: 11 }} className="text-muted-foreground" allowDecimals={false} />
                  <YAxis dataKey="status" type="category" tick={{ fontSize: 11 }} className="text-muted-foreground" width={80} />
                  <Tooltip contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))", background: "hsl(var(--background))" }} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {leadFunnel.map((entry, i) => (
                      <Cell key={i} fill={FUNNEL_COLORS[entry.status] || CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Jobs by Agent */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Award className="h-4 w-4 text-primary" />Jobs by Agent
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={jobsByAgent} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" tick={{ fontSize: 11 }} className="text-muted-foreground" allowDecimals={false} />
                  <YAxis dataKey="agent" type="category" tick={{ fontSize: 11 }} className="text-muted-foreground" width={100} />
                  <Tooltip contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))", background: "hsl(var(--background))" }} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {jobsByAgent.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top Agents Performance */}
      {topAgents.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-foreground mb-3 flex items-center gap-2">
            <Award className="h-4 w-4 text-primary" />Top Performers
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {topAgents.slice(0, 6).map((agent: any, i: number) => (
              <Card key={agent.agent_name} className="overflow-hidden">
                <div className="h-1.5" style={{
                  background: `linear-gradient(90deg, ${CHART_COLORS[i % CHART_COLORS.length]} ${Math.min(agent.performance_score, 100)}%, hsl(var(--muted)) ${Math.min(agent.performance_score, 100)}%)`,
                }} />
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm text-foreground">{agent.agent_name}</span>
                    <Badge variant="secondary">{Math.round(agent.performance_score)}pts</Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div>
                      <p className="text-muted-foreground">Jobs</p>
                      <p className="font-semibold text-foreground">{agent.jobs_completed}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Revenue</p>
                      <p className="font-semibold text-foreground">R{Number(agent.total_revenue).toLocaleString("en-ZA")}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Avg Days</p>
                      <p className="font-semibold text-foreground">{Number(agent.avg_completion_days).toFixed(1)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AnalyticsDashboard;
