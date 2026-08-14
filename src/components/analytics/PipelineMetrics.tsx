import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Percent, Clock, Trophy } from "lucide-react";
import RandSign from "@/components/icons/RandSign";
import { subDays } from "date-fns";
import { useMemo } from "react";

const formatZAR = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 })
    .format(Math.round(n || 0));

const formatHours = (hours: number) => {
  if (!isFinite(hours) || hours <= 0) return "—";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${Math.round(hours / 24)}d`;
};

const OPEN_STATUSES = ["draft", "sent", "pending", "viewed"];

/**
 * Pipeline health metrics — 90-day rolling window.
 * Lead Conversion Rate, Avg Time to Quote, Open Quotes Value, Win Rate.
 */
const PipelineMetrics = () => {
  const since = useMemo(() => subDays(new Date(), 90).toISOString(), []);

  const { data, isLoading } = useQuery({
    queryKey: ["pipeline-metrics-90d", since],
    staleTime: 60_000,
    queryFn: async () => {
      const [leadsRes, quotesRes, openRes] = await Promise.all([
        // Leads created in the last 90d (need count + ids to detect conversions)
        supabase
          .from("leads")
          .select("id, created_at")
          .gte("created_at", since),
        // Quotes created in the last 90d — for conversion, time-to-quote, win rate
        supabase
          .from("quotes")
          .select("id, lead_id, status, total, created_at, accepted_at, declined_at")
          .neq("status", "superseded")
          .gte("created_at", since),
        // Open quote value (regardless of window — reflects live pipeline)
        supabase
          .from("quotes")
          .select("total, status")
          .neq("status", "superseded")
          .in("status", OPEN_STATUSES),

      ]);

      if (leadsRes.error) throw leadsRes.error;
      if (quotesRes.error) throw quotesRes.error;
      if (openRes.error) throw openRes.error;

      const leads = leadsRes.data ?? [];
      const quotes = quotesRes.data ?? [];
      const open = openRes.data ?? [];

      const leadMap = new Map(leads.map((l) => [l.id, new Date(l.created_at).getTime()]));

      // Conversion: leads (in window) that have at least one quote
      const convertedLeadIds = new Set<string>();
      const timeDiffsMs: number[] = [];
      for (const q of quotes) {
        if (!q.lead_id) continue;
        const leadTs = leadMap.get(q.lead_id);
        if (leadTs != null) {
          convertedLeadIds.add(q.lead_id);
          const diff = new Date(q.created_at).getTime() - leadTs;
          if (diff >= 0) timeDiffsMs.push(diff);
        }
      }

      const conversionRate = leads.length ? (convertedLeadIds.size / leads.length) * 100 : 0;
      const avgTimeToQuoteH = timeDiffsMs.length
        ? timeDiffsMs.reduce((a, b) => a + b, 0) / timeDiffsMs.length / 3_600_000
        : 0;

      const openValue = open.reduce((sum, q) => sum + Number(q.total || 0), 0);

      // Win rate: accepted / (accepted + declined) among quotes created in window
      const accepted = quotes.filter((q) => q.status === "accepted" || q.accepted_at).length;
      const declined = quotes.filter((q) => q.status === "declined" || q.status === "rejected" || q.declined_at).length;
      const winRate = accepted + declined > 0 ? (accepted / (accepted + declined)) * 100 : 0;

      return {
        conversionRate,
        avgTimeToQuoteH,
        openValue,
        openCount: open.length,
        winRate,
        leadsCount: leads.length,
        convertedCount: convertedLeadIds.size,
        acceptedCount: accepted,
        declinedCount: declined,
      };
    },
  });

  const cards = [
    {
      key: "conv",
      label: "Lead Conversion",
      value: data ? `${data.conversionRate.toFixed(0)}%` : "—",
      hint: data ? `${data.convertedCount}/${data.leadsCount} leads → quote` : "",
      icon: Percent,
      accent: "text-primary",
    },
    {
      key: "ttq",
      label: "Avg Time to Quote",
      value: data ? formatHours(data.avgTimeToQuoteH) : "—",
      hint: "Lead created → first quote",
      icon: Clock,
      accent: "text-blue-500",
    },
    {
      key: "open",
      label: "Open Quotes Value",
      value: data ? formatZAR(data.openValue) : "—",
      hint: data ? `${data.openCount} open ${data.openCount === 1 ? "quote" : "quotes"}` : "",
      icon: RandSign,
      accent: "text-orange-500",
    },
    {
      key: "win",
      label: "Win Rate",
      value: data ? `${data.winRate.toFixed(0)}%` : "—",
      hint: data ? `${data.acceptedCount} won · ${data.declinedCount} lost` : "",
      icon: Trophy,
      accent: "text-green-600",
    },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Pipeline health
        </h2>
        <span className="text-[11px] text-muted-foreground">Last 90 days</span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-3">
        {cards.map((c) => (
          <Card key={c.key} className="surface-card surface-card-interactive">
            <CardContent className="p-3 md:p-4">
              <div className="flex items-center gap-2 mb-1">
                <c.icon className={`h-4 w-4 ${c.accent}`} />
                <span className="text-[11px] md:text-xs text-muted-foreground truncate">{c.label}</span>
              </div>
              {isLoading ? (
                <>
                  <Skeleton className="h-7 w-20 mb-1" />
                  <Skeleton className="h-3 w-24" />
                </>
              ) : (
                <>
                  <p className="text-xl md:text-2xl font-bold tabular-nums leading-tight">{c.value}</p>
                  {c.hint && (
                    <p className="text-[10px] md:text-[11px] text-muted-foreground mt-0.5 truncate">
                      {c.hint}
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default PipelineMetrics;
