import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  DollarSign,
  FileText,
  Briefcase,
  AlertTriangle,
  TrendingUp,
  Award,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import KPICard from "./KPICard";
import FuzzySearchBar from "./FuzzySearchBar";
import AnalyticsHeatMap from "./AnalyticsHeatMap";

const CHART_COLORS = [
  "hsl(142, 76%, 36%)", // green
  "hsl(204, 100%, 36%)", // blue
  "hsl(38, 92%, 50%)",  // amber
  "hsl(0, 84%, 60%)",   // red
  "hsl(262, 80%, 50%)", // purple
  "hsl(180, 70%, 40%)", // teal
];

const AGING_COLORS: Record<string, string> = {
  "0-30 days": "hsl(142, 76%, 36%)",
  "31-60 days": "hsl(38, 92%, 50%)",
  "61-90 days": "hsl(25, 95%, 53%)",
  "91+ days": "hsl(0, 84%, 60%)",
};

const FUNNEL_COLORS: Record<string, string> = {
  draft: "hsl(220, 9%, 46%)",
  sent: "hsl(204, 100%, 36%)",
  viewed: "hsl(38, 92%, 50%)",
  accepted: "hsl(142, 76%, 36%)",
  declined: "hsl(0, 84%, 60%)",
};

const AnalyticsDashboard = () => {
  // KPI queries
  const { data: totalRevenue = 0 } = useQuery({
    queryKey: ["kpi-total-revenue"],
    queryFn: async () => {
      const { data } = await supabase.from("invoices").select("grand_total").eq("status", "paid");
      return data?.reduce((sum, i) => sum + Number(i.grand_total), 0) || 0;
    },
  });

  const { data: pendingQuotes = 0 } = useQuery({
    queryKey: ["kpi-pending-quotes"],
    queryFn: async () => {
      const { count } = await supabase.from("quotes").select("*", { count: "exact", head: true }).in("status", ["draft", "sent"]);
      return count || 0;
    },
  });

  const { data: activeJobs = 0 } = useQuery({
    queryKey: ["kpi-active-jobs"],
    queryFn: async () => {
      const { count } = await supabase.from("leads").select("*", { count: "exact", head: true }).in("status", ["assigned", "in_progress", "en_route"]);
      return count || 0;
    },
  });

  const { data: overdueData = { count: 0, total: 0 } } = useQuery({
    queryKey: ["kpi-overdue"],
    queryFn: async () => {
      const { data } = await supabase.from("invoices").select("grand_total").eq("status", "overdue");
      return { count: data?.length || 0, total: data?.reduce((s, i) => s + Number(i.grand_total), 0) || 0 };
    },
  });

  // Chart queries
  const { data: revenueTrend = [] } = useQuery({
    queryKey: ["chart-revenue-trend"],
    queryFn: async () => {
      const { data } = await supabase.rpc("revenue_trend_monthly");
      return (data as any[]) || [];
    },
  });

  const { data: funnelData = [] } = useQuery({
    queryKey: ["chart-funnel"],
    queryFn: async () => {
      const { data } = await supabase.rpc("quote_conversion_funnel");
      return (data as any[]) || [];
    },
  });

  const { data: agingData = [] } = useQuery({
    queryKey: ["chart-aging"],
    queryFn: async () => {
      const { data } = await supabase.rpc("get_invoice_aging_report");
      return (data as any[]) || [];
    },
  });

  const { data: serviceData = [] } = useQuery({
    queryKey: ["chart-service-breakdown"],
    queryFn: async () => {
      const { data } = await supabase.rpc("revenue_by_service_type");
      return (data as any[]) || [];
    },
  });

  const { data: agentPerformance = [] } = useQuery({
    queryKey: ["chart-agent-performance"],
    queryFn: async () => {
      const { data } = await supabase.rpc("agent_performance_scores");
      return (data as any[]) || [];
    },
  });

  return (
    <div className="min-h-screen bg-muted/30 p-4 md:p-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground tracking-tight">Analytics</h1>
          <p className="text-muted-foreground mt-1">Business intelligence & performance insights</p>
        </div>
        <FuzzySearchBar />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        <KPICard
          label="Total Revenue"
          value={totalRevenue}
          prefix="R"
          icon={DollarSign}
          gradient="linear-gradient(135deg, hsl(142, 76%, 30%) 0%, hsl(142, 76%, 40%) 100%)"
        />
        <KPICard
          label="Pending Quotes"
          value={pendingQuotes}
          icon={FileText}
          gradient="linear-gradient(135deg, hsl(204, 100%, 30%) 0%, hsl(204, 100%, 42%) 100%)"
        />
        <KPICard
          label="Active Jobs"
          value={activeJobs}
          icon={Briefcase}
          gradient="linear-gradient(135deg, hsl(38, 92%, 40%) 0%, hsl(38, 92%, 54%) 100%)"
        />
        <KPICard
          label="Overdue Invoices"
          value={overdueData.count}
          suffix={overdueData.total > 0 ? ` (R${Math.round(overdueData.total).toLocaleString("en-ZA")})` : ""}
          icon={AlertTriangle}
          gradient="linear-gradient(135deg, hsl(0, 84%, 50%) 0%, hsl(0, 84%, 64%) 100%)"
        />
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        {/* Revenue Trend */}
        <Card className="rounded-2xl shadow-lg border-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" /> Revenue Trend (12 Months)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueTrend}>
                  <defs>
                    <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(142, 76%, 36%)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(142, 76%, 36%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 13%, 91%)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(220, 9%, 46%)" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(220, 9%, 46%)" tickFormatter={(v) => `R${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => [`R${v.toLocaleString("en-ZA")}`, "Revenue"]} />
                  <Area type="monotone" dataKey="revenue" stroke="hsl(142, 76%, 36%)" fill="url(#revenueGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Quote Funnel */}
        <Card className="rounded-2xl shadow-lg border-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Quote Conversion Funnel</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnelData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 13%, 91%)" />
                  <XAxis dataKey="status" tick={{ fontSize: 11 }} stroke="hsl(220, 9%, 46%)" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(220, 9%, 46%)" />
                  <Tooltip />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                    {funnelData.map((entry: any, i: number) => (
                      <Cell key={i} fill={FUNNEL_COLORS[entry.status] || CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        {/* Invoice Aging */}
        <Card className="rounded-2xl shadow-lg border-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Invoice Aging</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={agingData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 13%, 91%)" />
                  <XAxis dataKey="bracket" tick={{ fontSize: 11 }} stroke="hsl(220, 9%, 46%)" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(220, 9%, 46%)" tickFormatter={(v) => `R${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => `R${v.toLocaleString("en-ZA")}`} />
                  <Bar dataKey="total_outstanding" radius={[6, 6, 0, 0]}>
                    {agingData.map((entry: any, i: number) => (
                      <Cell key={i} fill={AGING_COLORS[entry.bracket] || CHART_COLORS[i]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Service Breakdown */}
        <Card className="rounded-2xl shadow-lg border-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Revenue by Service Type</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={serviceData}
                    dataKey="total"
                    nameKey="service_category"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    innerRadius={50}
                    paddingAngle={3}
                    label={({ service_category, percent }) => `${service_category} (${(percent * 100).toFixed(0)}%)`}
                    labelLine={false}
                  >
                    {serviceData.map((_: any, i: number) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => `R${v.toLocaleString("en-ZA")}`} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Agent Performance */}
      {agentPerformance.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <Award className="h-5 w-5 text-primary" /> Agent Performance
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {agentPerformance.map((agent: any, i: number) => (
              <Card key={agent.agent_name} className="rounded-2xl shadow-lg border-0 overflow-hidden">
                <div
                  className="h-2"
                  style={{
                    background: `linear-gradient(90deg, hsl(142, 76%, 36%) ${Math.min(agent.performance_score, 100)}%, hsl(220, 13%, 91%) ${Math.min(agent.performance_score, 100)}%)`,
                  }}
                />
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-foreground">{agent.agent_name}</h3>
                    <span className="text-2xl font-bold text-primary">
                      {Math.round(agent.performance_score)}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-xs text-muted-foreground">Jobs</p>
                      <p className="font-semibold text-foreground">{agent.jobs_completed}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Revenue</p>
                      <p className="font-semibold text-foreground">R{Number(agent.total_revenue).toLocaleString("en-ZA")}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Avg Days</p>
                      <p className="font-semibold text-foreground">{Number(agent.avg_completion_days).toFixed(1)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Heat Map */}
      <Card className="rounded-2xl shadow-lg border-0">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Job Density Heat Map</CardTitle>
        </CardHeader>
        <CardContent>
          <AnalyticsHeatMap />
        </CardContent>
      </Card>
    </div>
  );
};

export default AnalyticsDashboard;
