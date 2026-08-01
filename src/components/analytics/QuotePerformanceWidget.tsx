import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart3, Mail, MousePointerClick } from "lucide-react";

type DateFilter = "last_30" | "all_time";

function ctrColor(ctr: number): string {
  if (ctr > 8) return "bg-green-100 text-green-700";
  if (ctr >= 3) return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

const QuotePerformanceWidget = () => {
  const [dateFilter, setDateFilter] = useState<DateFilter>("last_30");

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["quote-email-events", dateFilter],
    queryFn: async () => {
      let q = supabase.from("email_events").select("*").order("created_at", { ascending: false });
      if (dateFilter === "last_30") {
        const since = new Date();
        since.setDate(since.getDate() - 30);
        q = q.gte("created_at", since.toISOString());
      }
      const { data } = await q;
      return data || [];
    },
  });

  const metrics = useMemo(() => {
    const byQuote: Record<string, { sent: number; delivered: number; opened: number; clicked: number }> = {};
    for (const e of events) {
      const qn = e.quote_number || "Unknown";
      if (!byQuote[qn]) byQuote[qn] = { sent: 0, delivered: 0, opened: 0, clicked: 0 };
      if (e.event_type === "sent") byQuote[qn].sent++;
      else if (e.event_type === "delivered") byQuote[qn].delivered++;
      else if (e.event_type === "opened") byQuote[qn].opened++;
      else if (e.event_type === "clicked") byQuote[qn].clicked++;
    }

    const rows = Object.entries(byQuote).map(([quoteNumber, counts]) => ({
      quoteNumber,
      ...counts,
      openRate: counts.delivered > 0 ? (counts.opened / counts.delivered) * 100 : 0,
      ctr: counts.delivered > 0 ? (counts.clicked / counts.delivered) * 100 : 0,
    }));

    const totalSent = rows.reduce((s, r) => s + r.sent, 0);
    const totalDelivered = rows.reduce((s, r) => s + r.delivered, 0);
    const totalClicked = rows.reduce((s, r) => s + r.clicked, 0);
    const avgCtr = totalDelivered > 0 ? (totalClicked / totalDelivered) * 100 : 0;

    return { rows, totalSent, avgCtr };
  }, [events]);

  return (
    <Card className="surface-card-solid">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            Quote Performance
          </CardTitle>
          <Select value={dateFilter} onValueChange={(v) => setDateFilter(v as DateFilter)}>
            <SelectTrigger className="w-[130px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="last_30">Last 30 Days</SelectItem>
              <SelectItem value="all_time">All Time</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Summary stats */}
        <div className="flex gap-4">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{metrics.totalSent} sent</span>
          </div>
          <div className="flex items-center gap-2">
            <MousePointerClick className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">
              Avg CTR: <Badge variant="secondary" className={ctrColor(metrics.avgCtr)}>{metrics.avgCtr.toFixed(1)}%</Badge>
            </span>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : metrics.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No quote emails sent yet</p>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Quote #</TableHead>
                  <TableHead className="text-xs text-center">Sent</TableHead>
                  <TableHead className="text-xs text-center">Delivered</TableHead>
                  <TableHead className="text-xs text-center">Opened</TableHead>
                  <TableHead className="text-xs text-center">Clicks</TableHead>
                  <TableHead className="text-xs text-center">Open %</TableHead>
                  <TableHead className="text-xs text-center">CTR %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {metrics.rows.map((row) => (
                  <TableRow key={row.quoteNumber}>
                    <TableCell className="text-xs font-medium text-primary">{row.quoteNumber}</TableCell>
                    <TableCell className="text-xs text-center">{row.sent}</TableCell>
                    <TableCell className="text-xs text-center">{row.delivered}</TableCell>
                    <TableCell className="text-xs text-center">{row.opened}</TableCell>
                    <TableCell className="text-xs text-center">{row.clicked}</TableCell>
                    <TableCell className="text-xs text-center">
                      <Badge variant="secondary" className="text-[10px]">{row.openRate.toFixed(0)}%</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-center">
                      <Badge variant="secondary" className={`text-[10px] ${ctrColor(row.ctr)}`}>{row.ctr.toFixed(1)}%</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default QuotePerformanceWidget;
