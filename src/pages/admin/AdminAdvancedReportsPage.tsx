import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { format, subDays, startOfWeek, startOfYear, startOfMonth } from "date-fns";
import {
  BarChart, Bar, PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
} from "recharts";
import { BarChart3, CalendarDays, Download, FileText, Users, Wrench, TrendingUp, Clock, Star, AlertTriangle } from "lucide-react";
import RandSign from "@/components/icons/RandSign";
import { exportToCSV } from "@/lib/csvExport";
import jsPDF from "jspdf";
import logo from "@/assets/logo.png";

// ─── Types ───
interface DateRange { from: Date; to: Date }

interface Lead {
  id: string;
  service_type: string;
  status: string;
  created_at: string | null;
  completed_at: string | null;
  assigned_agent_id: string | null;
  customer_address: string;
  priority: string;
}

interface Agent {
  id: string;
  full_name: string;
}

interface Feedback {
  agent_id: string;
  rating: number;
  lead_id: string | null;
}

interface MaintenanceSchedule {
  id: string;
  status: string;
  due_date: string;
}

// ─── Presets ───
const DATE_PRESETS = [
  { label: "This Week", getRange: () => ({ from: startOfWeek(new Date(), { weekStartsOn: 1 }), to: new Date() }) },
  { label: "Last 30 Days", getRange: () => ({ from: subDays(new Date(), 30), to: new Date() }) },
  { label: "This Month", getRange: () => ({ from: startOfMonth(new Date()), to: new Date() }) },
  { label: "This Year", getRange: () => ({ from: startOfYear(new Date()), to: new Date() }) },
];

const PIE_COLORS = [
  "hsl(217, 91%, 60%)", "hsl(142, 76%, 36%)", "hsl(38, 92%, 50%)",
  "hsl(340, 82%, 52%)", "hsl(262, 83%, 58%)", "hsl(180, 70%, 45%)",
];

const AdminAdvancedReportsPage = () => {
  const { toast } = useToast();
  const [dateRange, setDateRange] = useState<DateRange>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });
  const [techFilter, setTechFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [suburbFilter, setSuburbFilter] = useState<string>("all");

  const startISO = dateRange.from.toISOString();
  const endISO = dateRange.to.toISOString();

  // ─── Data Queries ───
  const { data: leads = [], isLoading: leadsLoading } = useQuery({
    queryKey: ["adv-reports-leads", startISO, endISO],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("id, service_type, status, created_at, completed_at, assigned_agent_id, customer_address, priority")
        .gte("created_at", startISO)
        .lte("created_at", endISO);
      if (error) throw error;
      return (data || []) as Lead[];
    },
  });

  const { data: agents = [] } = useQuery({
    queryKey: ["adv-reports-agents"],
    queryFn: async () => {
      const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "field_agent");
      if (!roles?.length) return [];
      const { data } = await supabase.from("profiles").select("id, full_name").in("id", roles.map(r => r.user_id));
      return (data || []) as Agent[];
    },
  });

  const { data: feedback = [] } = useQuery({
    queryKey: ["adv-reports-feedback", startISO, endISO],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_feedback")
        .select("agent_id, rating, lead_id")
        .gte("created_at", startISO)
        .lte("created_at", endISO);
      if (error) throw error;
      return (data || []) as Feedback[];
    },
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ["adv-reports-invoices", startISO, endISO],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, grand_total, status, issue_date, lead_id, agent_id")
        .gte("issue_date", format(dateRange.from, "yyyy-MM-dd"))
        .lte("issue_date", format(dateRange.to, "yyyy-MM-dd"));
      if (error) throw error;
      return data || [];
    },
  });

  const { data: maintenance = [] } = useQuery({
    queryKey: ["adv-reports-maintenance", startISO, endISO],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maintenance_schedules")
        .select("id, status, due_date")
        .gte("due_date", format(dateRange.from, "yyyy-MM-dd"))
        .lte("due_date", format(dateRange.to, "yyyy-MM-dd"));
      if (error) throw error;
      return (data || []) as MaintenanceSchedule[];
    },
  });

  const isLoading = leadsLoading;
  const agentMap = useMemo(() => new Map(agents.map(a => [a.id, a.full_name])), [agents]);

  // ─── Derived: extract unique suburbs & service types ───
  const suburbs = useMemo(() => {
    const set = new Set<string>();
    leads.forEach(l => {
      const parts = l.customer_address?.split(",").map(s => s.trim()) || [];
      if (parts.length >= 2) set.add(parts[parts.length - 2]);
    });
    return Array.from(set).sort();
  }, [leads]);

  const serviceTypes = useMemo(() => {
    const set = new Set<string>();
    leads.forEach(l => set.add(l.service_type));
    return Array.from(set).sort();
  }, [leads]);

  // ─── Filtered leads ───
  const filteredLeads = useMemo(() => {
    return leads.filter(l => {
      if (techFilter !== "all" && l.assigned_agent_id !== techFilter) return false;
      if (typeFilter !== "all" && l.service_type !== typeFilter) return false;
      if (suburbFilter !== "all") {
        const parts = l.customer_address?.split(",").map(s => s.trim()) || [];
        const suburb = parts.length >= 2 ? parts[parts.length - 2] : "";
        if (suburb !== suburbFilter) return false;
      }
      return true;
    });
  }, [leads, techFilter, typeFilter, suburbFilter]);

  // ─── Technician Performance Data ───
  const techPerformance = useMemo(() => {
    const map = new Map<string, { completed: number; totalDays: number; count: number; ratings: number[]; name: string }>();
    filteredLeads.forEach(l => {
      if (!l.assigned_agent_id) return;
      const name = agentMap.get(l.assigned_agent_id) || "Unknown";
      if (!map.has(l.assigned_agent_id)) map.set(l.assigned_agent_id, { completed: 0, totalDays: 0, count: 0, ratings: [], name });
      const entry = map.get(l.assigned_agent_id)!;
      if (l.status === "completed") {
        entry.completed++;
        if (l.created_at && l.completed_at) {
          const days = (new Date(l.completed_at).getTime() - new Date(l.created_at).getTime()) / 86400000;
          entry.totalDays += days;
          entry.count++;
        }
      }
    });
    feedback.forEach(f => {
      if (map.has(f.agent_id)) map.get(f.agent_id)!.ratings.push(f.rating);
    });
    return Array.from(map.values()).map(e => ({
      name: e.name,
      completed: e.completed,
      avgDays: e.count > 0 ? Math.round((e.totalDays / e.count) * 10) / 10 : 0,
      avgRating: e.ratings.length > 0 ? Math.round((e.ratings.reduce((a, b) => a + b, 0) / e.ratings.length) * 10) / 10 : 0,
    })).sort((a, b) => b.completed - a.completed);
  }, [filteredLeads, feedback, agentMap]);

  // ─── Revenue Breakdown ───
  const revenueByType = useMemo(() => {
    const map = new Map<string, number>();
    // Map invoices to leads to get service type
    const leadMap = new Map(leads.map(l => [l.id, l]));
    invoices.forEach(inv => {
      if (inv.status === "cancelled") return;
      const lead = inv.lead_id ? leadMap.get(inv.lead_id) : null;
      const type = lead?.service_type || "Other";
      map.set(type, (map.get(type) || 0) + Number(inv.grand_total));
    });
    return Array.from(map.entries()).map(([name, value]) => ({ name, value: Math.round(value) }));
  }, [invoices, leads]);

  const dailyRevenue = useMemo(() => {
    const map = new Map<string, number>();
    invoices.forEach(inv => {
      if (inv.status === "cancelled") return;
      const day = inv.issue_date;
      map.set(day, (map.get(day) || 0) + Number(inv.grand_total));
    });
    return Array.from(map.entries())
      .map(([date, revenue]) => ({ date: format(new Date(date), "dd MMM"), revenue: Math.round(revenue) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [invoices]);

  const totalRevenue = invoices.filter(i => i.status !== "cancelled").reduce((s, i) => s + Number(i.grand_total), 0);

  // ─── Maintenance Effectiveness ───
  const maintenanceStats = useMemo(() => {
    const total = maintenance.length;
    const completed = maintenance.filter(m => m.status === "completed").length;
    const overdue = maintenance.filter(m => m.status === "overdue").length;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    // Emergency ratio: emergency leads / total leads
    const emergencyLeads = filteredLeads.filter(l => l.priority === "urgent" || l.priority === "high").length;
    const emergencyRate = filteredLeads.length > 0 ? Math.round((emergencyLeads / filteredLeads.length) * 100) : 0;

    return { total, completed, overdue, completionRate, emergencyLeads, emergencyRate, totalLeads: filteredLeads.length };
  }, [maintenance, filteredLeads]);

  // ─── Export Handlers ───
  const handleCSVExport = (tab: string) => {
    let data: Record<string, any>[] = [];
    let filename = `report-${tab}-${format(dateRange.from, "yyyyMMdd")}-${format(dateRange.to, "yyyyMMdd")}`;

    if (tab === "performance") {
      data = techPerformance.map(t => ({
        Technician: t.name,
        "Jobs Completed": t.completed,
        "Avg Completion Days": t.avgDays,
        "Avg Rating": t.avgRating,
      }));
    } else if (tab === "revenue") {
      data = revenueByType.map(r => ({ "Service Type": r.name, "Revenue (R)": r.value }));
    } else if (tab === "maintenance") {
      data = [
        { Metric: "Total Schedules", Value: maintenanceStats.total },
        { Metric: "Completed", Value: maintenanceStats.completed },
        { Metric: "Overdue", Value: maintenanceStats.overdue },
        { Metric: "Completion Rate %", Value: maintenanceStats.completionRate },
        { Metric: "Emergency Calls", Value: maintenanceStats.emergencyLeads },
        { Metric: "Emergency Rate %", Value: maintenanceStats.emergencyRate },
      ];
    }
    if (!data.length) { toast({ title: "No data to export" }); return; }
    exportToCSV(data, filename);
    toast({ title: "CSV exported ✅" });
  };

  const handlePDFExport = (tab: string) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    // Header with logo placeholder
    doc.setFillColor(0, 119, 182);
    doc.rect(0, 0, pageWidth, 28, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.text("Advanced Report", 14, 14);
    doc.setFontSize(9);
    doc.text(`${format(dateRange.from, "dd MMM yyyy")} – ${format(dateRange.to, "dd MMM yyyy")}`, 14, 22);
    doc.text(`Generated: ${format(new Date(), "dd MMM yyyy HH:mm")}`, pageWidth - 14, 22, { align: "right" });

    doc.setTextColor(0, 0, 0);
    let y = 38;

    if (tab === "performance") {
      doc.setFontSize(14);
      doc.text("Technician Performance", 14, y); y += 10;
      doc.setFontSize(9);
      doc.text("Technician | Jobs | Avg Days | Rating", 14, y); y += 6;
      doc.setDrawColor(200); doc.line(14, y, pageWidth - 14, y); y += 4;
      techPerformance.forEach(t => {
        doc.text(`${t.name} | ${t.completed} | ${t.avgDays}d | ${t.avgRating}★`, 14, y);
        y += 6;
      });
    } else if (tab === "revenue") {
      doc.setFontSize(14);
      doc.text("Revenue Breakdown", 14, y); y += 10;
      doc.setFontSize(10);
      doc.text(`Total Revenue: R ${totalRevenue.toLocaleString()}`, 14, y); y += 8;
      doc.setFontSize(9);
      revenueByType.forEach(r => {
        doc.text(`${r.name}: R ${r.value.toLocaleString()}`, 14, y);
        y += 6;
      });
    } else if (tab === "maintenance") {
      doc.setFontSize(14);
      doc.text("Maintenance Effectiveness", 14, y); y += 10;
      doc.setFontSize(9);
      const stats = [
        `Total Schedules: ${maintenanceStats.total}`,
        `Completed: ${maintenanceStats.completed}`,
        `Overdue: ${maintenanceStats.overdue}`,
        `Completion Rate: ${maintenanceStats.completionRate}%`,
        `Emergency Calls: ${maintenanceStats.emergencyLeads} (${maintenanceStats.emergencyRate}%)`,
      ];
      stats.forEach(s => { doc.text(s, 14, y); y += 6; });
    }

    doc.save(`report-${tab}-${format(new Date(), "yyyyMMdd")}.pdf`);
    toast({ title: "PDF exported ✅" });
  };

  // ─── Render ───
  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" />
            Advanced Reports
          </h1>
          <p className="text-sm text-muted-foreground">In-depth business analytics with exports</p>
        </div>
      </div>

      {/* Date Range + Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-end gap-3">
            {/* Date range presets */}
            <div className="flex flex-wrap gap-1.5">
              {DATE_PRESETS.map(p => {
                const range = p.getRange();
                const isActive = format(dateRange.from, "yyyy-MM-dd") === format(range.from, "yyyy-MM-dd");
                return (
                  <Button
                    key={p.label}
                    variant={isActive ? "default" : "outline"}
                    size="sm"
                    onClick={() => setDateRange(range)}
                    className="text-xs"
                  >
                    {p.label}
                  </Button>
                );
              })}
            </div>

            {/* Custom date pickers */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 text-xs">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {format(dateRange.from, "dd MMM")} – {format(dateRange.to, "dd MMM yyyy")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="range"
                  selected={{ from: dateRange.from, to: dateRange.to }}
                  onSelect={(range) => {
                    if (range?.from && range?.to) setDateRange({ from: range.from, to: range.to });
                    else if (range?.from) setDateRange({ from: range.from, to: range.from });
                  }}
                  numberOfMonths={2}
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>

            <div className="ml-auto flex flex-wrap gap-2">
              {/* Technician filter */}
              <Select value={techFilter} onValueChange={setTechFilter}>
                <SelectTrigger className="w-[160px] h-8 text-xs">
                  <Users className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                  <SelectValue placeholder="All Technicians" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Technicians</SelectItem>
                  {agents.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Service type filter */}
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[150px] h-8 text-xs">
                  <Wrench className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {serviceTypes.map(t => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Suburb filter */}
              {suburbs.length > 0 && (
                <Select value={suburbFilter} onValueChange={setSuburbFilter}>
                  <SelectTrigger className="w-[150px] h-8 text-xs">
                    <SelectValue placeholder="All Suburbs" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Suburbs</SelectItem>
                    {suburbs.map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard icon={<FileText className="h-4 w-4" />} label="Total Jobs" value={filteredLeads.length} loading={isLoading} />
        <KPICard icon={<RandSign className="h-4 w-4 text-emerald-500" />} label="Revenue" value={`R ${Math.round(totalRevenue).toLocaleString()}`} loading={isLoading} />
        <KPICard icon={<Clock className="h-4 w-4 text-primary" />} label="Completed" value={filteredLeads.filter(l => l.status === "completed").length} loading={isLoading} />
        <KPICard icon={<Star className="h-4 w-4 text-yellow-500" />} label="Avg Rating" value={feedback.length > 0 ? (feedback.reduce((s, f) => s + f.rating, 0) / feedback.length).toFixed(1) : "—"} loading={isLoading} />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="performance" className="space-y-4">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="performance" className="gap-1.5"><Users className="h-3.5 w-3.5" /> Performance</TabsTrigger>
          <TabsTrigger value="revenue" className="gap-1.5"><RandSign className="h-3.5 w-3.5" /> Revenue</TabsTrigger>
          <TabsTrigger value="maintenance" className="gap-1.5"><Wrench className="h-3.5 w-3.5" /> Maintenance</TabsTrigger>
        </TabsList>

        {/* ─── Performance Tab ─── */}
        <TabsContent value="performance" className="space-y-4">
          <div className="flex justify-end gap-2">
            <ExportButton label="CSV" onClick={() => handleCSVExport("performance")} />
            <ExportButton label="PDF" onClick={() => handlePDFExport("performance")} />
          </div>

          {isLoading ? (
            <Skeleton className="h-[350px] w-full" />
          ) : techPerformance.length === 0 ? (
            <EmptyState message="No technician data for this period" />
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Jobs Completed by Technician</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={techPerformance}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <RechartsTooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="completed" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Jobs" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Avg Completion Time & Rating</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={techPerformance}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="right" orientation="right" domain={[0, 5]} tick={{ fontSize: 11 }} />
                      <RechartsTooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                      <Legend />
                      <Bar yAxisId="left" dataKey="avgDays" fill="hsl(38, 92%, 50%)" radius={[4, 4, 0, 0]} name="Avg Days" />
                      <Bar yAxisId="right" dataKey="avgRating" fill="hsl(142, 76%, 36%)" radius={[4, 4, 0, 0]} name="Avg Rating" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Leaderboard table */}
              <Card className="md:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Technician Leaderboard</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-muted-foreground text-xs">
                          <th className="text-left py-2 px-3">#</th>
                          <th className="text-left py-2 px-3">Technician</th>
                          <th className="text-right py-2 px-3">Completed</th>
                          <th className="text-right py-2 px-3">Avg Days</th>
                          <th className="text-right py-2 px-3">Avg Rating</th>
                        </tr>
                      </thead>
                      <tbody>
                        {techPerformance.map((t, i) => (
                          <tr key={t.name} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                            <td className="py-2 px-3 text-muted-foreground">{i + 1}</td>
                            <td className="py-2 px-3 font-medium">{t.name}</td>
                            <td className="py-2 px-3 text-right">{t.completed}</td>
                            <td className="py-2 px-3 text-right">{t.avgDays}d</td>
                            <td className="py-2 px-3 text-right">
                              {t.avgRating > 0 ? (
                                <span className="flex items-center justify-end gap-1">
                                  {t.avgRating} <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                                </span>
                              ) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* ─── Revenue Tab ─── */}
        <TabsContent value="revenue" className="space-y-4">
          <div className="flex justify-end gap-2">
            <ExportButton label="CSV" onClick={() => handleCSVExport("revenue")} />
            <ExportButton label="PDF" onClick={() => handlePDFExport("revenue")} />
          </div>

          {isLoading ? (
            <Skeleton className="h-[350px] w-full" />
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Revenue by Service Type</CardTitle>
                  <CardDescription className="text-xs">Total: R {totalRevenue.toLocaleString()}</CardDescription>
                </CardHeader>
                <CardContent>
                  {revenueByType.length === 0 ? (
                    <EmptyState message="No invoice data for this period" />
                  ) : (
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={revenueByType}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={100}
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          labelLine={false}
                        >
                          {revenueByType.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <RechartsTooltip
                          formatter={(value: number) => `R ${value.toLocaleString()}`}
                          contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                        />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Daily Revenue Trend</CardTitle>
                </CardHeader>
                <CardContent>
                  {dailyRevenue.length === 0 ? (
                    <EmptyState message="No daily revenue data" />
                  ) : (
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={dailyRevenue}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <RechartsTooltip
                          formatter={(value: number) => `R ${value.toLocaleString()}`}
                          contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                        />
                        <Line type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="Revenue" />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* ─── Maintenance Tab ─── */}
        <TabsContent value="maintenance" className="space-y-4">
          <div className="flex justify-end gap-2">
            <ExportButton label="CSV" onClick={() => handleCSVExport("maintenance")} />
            <ExportButton label="PDF" onClick={() => handlePDFExport("maintenance")} />
          </div>

          {isLoading ? (
            <Skeleton className="h-[250px] w-full" />
          ) : (
            <div className="grid md:grid-cols-3 gap-4">
              <Card>
                <CardContent className="pt-6 text-center">
                  <div className="text-4xl font-bold text-primary">{maintenanceStats.completionRate}%</div>
                  <p className="text-sm text-muted-foreground mt-1">Completion Rate</p>
                  <p className="text-xs text-muted-foreground">{maintenanceStats.completed} / {maintenanceStats.total} schedules</p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6 text-center">
                  <div className={cn("text-4xl font-bold", maintenanceStats.overdue > 0 ? "text-destructive" : "text-emerald-500")}>
                    {maintenanceStats.overdue}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">Overdue Schedules</p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6 text-center">
                  <div className={cn("text-4xl font-bold", maintenanceStats.emergencyRate > 30 ? "text-destructive" : "text-primary")}>
                    {maintenanceStats.emergencyRate}%
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">Emergency Call Rate</p>
                  <p className="text-xs text-muted-foreground">{maintenanceStats.emergencyLeads} of {maintenanceStats.totalLeads} jobs</p>
                </CardContent>
              </Card>

              <Card className="md:col-span-3">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Maintenance vs Emergency Calls</CardTitle>
                  <CardDescription className="text-xs">
                    Higher completion rates correlate with fewer emergency calls
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={[
                      { name: "Scheduled Maintenance", value: maintenanceStats.completed, fill: "hsl(var(--primary))" },
                      { name: "Overdue", value: maintenanceStats.overdue, fill: "hsl(var(--destructive))" },
                      { name: "Emergency Calls", value: maintenanceStats.emergencyLeads, fill: "hsl(38, 92%, 50%)" },
                    ]}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <RechartsTooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                        {[
                          { fill: "hsl(217, 91%, 60%)" },
                          { fill: "hsl(0, 84%, 60%)" },
                          { fill: "hsl(38, 92%, 50%)" },
                        ].map((entry, i) => (
                          <Cell key={i} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

// ─── Sub-components ───
function KPICard({ icon, label, value, loading }: { icon: React.ReactNode; label: string; value: string | number; loading: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1">
          {icon}
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        {loading ? <Skeleton className="h-8 w-24" /> : <p className="text-2xl font-bold">{value}</p>}
      </CardContent>
    </Card>
  );
}

function ExportButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} className="gap-1.5 text-xs border-primary/30 text-primary hover:bg-primary/10">
      <Download className="h-3.5 w-3.5" />
      {label}
    </Button>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
      <BarChart3 className="h-10 w-10 mb-3 opacity-40" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

export default AdminAdvancedReportsPage;
