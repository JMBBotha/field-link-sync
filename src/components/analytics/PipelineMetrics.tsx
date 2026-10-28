import { useQuery } from "@tanstack/react-query";
import { dealWinRate } from "@/lib/quotePipeline";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Percent, Clock, Trophy } from "lucide-react";
import RandSign from "@/components/icons/RandSign";
import { subDays } from "date-fns";
import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TILE_LINKS } from "@/lib/drilldown";

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
  const navigate = useNavigate();
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
          .select("id, lead_id, status, total, created_at, accepted_at, declined_at, option_group_id")
          .neq("status", "superseded")
          .is("archived_at", null)
          .gte("created_at", since),
        // Open quote value (regardless of window — reflects live pipeline)
        supabase
          .from("quotes")
          .select("total, status")
          .neq("status", "superseded")
          .is("archived_at", null)
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
      // Per deal: option quotes count once; "option not chosen" is never a loss.
      const wr = dealWinRate(quotes as any);
      const accepted = wr.won;
      const declined = wr.lost;
      const winRate = wr.rate;

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
      to: TILE_LINKS.openQuotesValue,
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
    <div className="v7-glass h-full space-y-2">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Pipeline health
        </h2>
        <span className="text-xs text-muted-foreground">Last 90 days</span>
      </div>

      <div className="grid gap-2 md:gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,9.5rem),1fr))]">
        {cards.map((c) => (
          <Card key={c.key} className={`surface-card surface-card-interactive ${"to" in c ? "cursor-pointer" : ""}`}
            {...("to" in c ? { role: "link", tabIndex: 0, onClick: () => navigate((c as any).to), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter") navigate((c as any).to); } } : {})}>
            <CardContent className="p-3 md:p-4 min-w-0">
              <div className="flex items-start gap-2 mb-1 min-w-0">
                <c.icon className={`h-4 w-4 shrink-0 mt-px ${c.accent}`} />
                <span className="text-xs md:text-xs text-muted-foreground leading-snug break-words min-w-0">{c.label}</span>
              </div>
              {isLoading ? (
                <>
                  <Skeleton className="h-7 w-20 mb-1" />
                  <Skeleton className="h-3 w-24" />
                </>
              ) : (
                <>
                  <p className="text-xl md:text-2xl kpi-fluid font-bold tabular-nums leading-tight [--kpi-max:1.5rem]">{c.value}</p>
                  {c.key === "win" && data ? (
                    <p className="text-xs md:text-xs text-muted-foreground mt-0.5 leading-snug break-words">
                      <Link to={TILE_LINKS.quotesWon90} className="hover:underline hover:text-foreground">{data.acceptedCount} won</Link>
                      {" · "}
                      <Link to={TILE_LINKS.quotesLost90} className="hover:underline hover:text-foreground">{data.declinedCount} lost</Link>
                    </p>
                  ) : c.hint && (
                    <p className="text-xs md:text-xs text-muted-foreground mt-0.5 leading-snug break-words">
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
