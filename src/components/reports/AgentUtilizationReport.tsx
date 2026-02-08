import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Download, Loader2 } from "lucide-react";
import { exportToCSV } from "@/lib/csvExport";

const formatZAR = (n: number) => `R ${Number(n).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`;

interface Props {
  startDate: string;
  endDate: string;
}

const AgentUtilizationReport = ({ startDate, endDate }: Props) => {
  const { data: agents = [], isLoading } = useQuery({
    queryKey: ["report-agent-util", startDate, endDate],
    queryFn: async () => {
      // Get time entries in date range
      const { data: entries } = await supabase
        .from("job_time_entries")
        .select("agent_id, hours_onsite, travel_hours, is_billable, work_date")
        .gte("work_date", startDate)
        .lte("work_date", endDate);

      // Get profiles
      const { data: profiles } = await supabase.from("profiles").select("id, full_name");

      // Get invoices for revenue
      const { data: invoices } = await supabase
        .from("invoices")
        .select("agent_id, grand_total")
        .eq("status", "paid")
        .gte("issue_date", startDate)
        .lte("issue_date", endDate);

      const profileMap = new Map((profiles || []).map((p) => [p.id, p.full_name]));
      const agentMap = new Map<string, { billable: number; nonBillable: number; travel: number; revenue: number }>();

      (entries || []).forEach((e) => {
        const curr = agentMap.get(e.agent_id) || { billable: 0, nonBillable: 0, travel: 0, revenue: 0 };
        const hours = Number(e.hours_onsite) || 0;
        if (e.is_billable) curr.billable += hours;
        else curr.nonBillable += hours;
        curr.travel += Number(e.travel_hours) || 0;
        agentMap.set(e.agent_id, curr);
      });

      (invoices || []).forEach((inv) => {
        const curr = agentMap.get(inv.agent_id) || { billable: 0, nonBillable: 0, travel: 0, revenue: 0 };
        curr.revenue += Number(inv.grand_total);
        agentMap.set(inv.agent_id, curr);
      });

      return Array.from(agentMap.entries()).map(([id, stats]) => {
        const totalHours = stats.billable + stats.nonBillable + stats.travel;
        return {
          id,
          name: profileMap.get(id) || "Unknown",
          billableHours: stats.billable,
          nonBillableHours: stats.nonBillable,
          travelHours: stats.travel,
          totalHours,
          utilization: totalHours > 0 ? Math.round((stats.billable / totalHours) * 100) : 0,
          revenue: stats.revenue,
        };
      }).sort((a, b) => b.utilization - a.utilization);
    },
  });

  const handleExport = () => {
    exportToCSV(
      agents.map((a) => ({
        Agent: a.name,
        "Billable Hours": a.billableHours.toFixed(1),
        "Non-Billable Hours": a.nonBillableHours.toFixed(1),
        "Travel Hours": a.travelHours.toFixed(1),
        "Total Hours": a.totalHours.toFixed(1),
        "Utilization %": a.utilization,
        Revenue: a.revenue.toFixed(2),
      })),
      `agent-utilization-${startDate}-${endDate}`
    );
  };

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      {/* Agent Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {agents.map((agent) => (
          <Card key={agent.id} className="rounded-2xl shadow-md border-0">
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-foreground">{agent.name}</h3>
                <span className={`text-xl font-bold ${agent.utilization >= 70 ? "text-green-600" : agent.utilization >= 40 ? "text-orange-600" : "text-red-600"}`}>
                  {agent.utilization}%
                </span>
              </div>
              <Progress value={agent.utilization} className="h-2" />
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-muted-foreground">Billable</p>
                  <p className="font-semibold">{agent.billableHours.toFixed(1)}h</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Revenue</p>
                  <p className="font-semibold">{formatZAR(agent.revenue)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Travel</p>
                  <p className="font-semibold">{agent.travelHours.toFixed(1)}h</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Total</p>
                  <p className="font-semibold">{agent.totalHours.toFixed(1)}h</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {agents.length === 0 && (
        <Card className="rounded-2xl shadow-md border-0">
          <CardContent className="py-12 text-center text-muted-foreground">
            No time entries found for this period.
          </CardContent>
        </Card>
      )}

      {agents.length > 0 && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        </div>
      )}
    </div>
  );
};

export default AgentUtilizationReport;
