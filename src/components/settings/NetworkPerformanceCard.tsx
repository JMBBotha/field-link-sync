import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCanWriteMasterCatalog } from "@/components/catalog/MasterCatalogGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export interface NetworkCompanyStats {
  company_id: string; name: string; is_master: boolean; leads_new: number; leads_completed: number; quotes_sent: number;
  quotes_accepted: number; accepted_value: number; jobs_booked: number; people: number; win_rate: number | null;
}
export const rand = (v: number) => `R ${Math.round(Number(v) || 0).toLocaleString("en-ZA")}`;
export const winRate = (c: Pick<NetworkCompanyStats, "win_rate">) => (c.win_rate == null ? "–" : `${c.win_rate}%`);

/** P7: master company admins only – totals per company in the network. Each company still only sees its own data elsewhere. */
export default function NetworkPerformanceCard() {
  const { canWrite } = useCanWriteMasterCatalog();
  const [days, setDays] = useState(30);
  const { data, error } = useQuery({
    queryKey: ["network-performance", days],
    enabled: canWrite,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("network_performance", { p_days: days });
      if (error) throw error;
      return (data?.companies || []) as NetworkCompanyStats[];
    },
  });
  if (!canWrite) return null;
  return (
    <Card data-testid="network-performance">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex flex-wrap items-center gap-2">Network performance
          <span className="ml-auto flex gap-1">{[30, 90].map((d) => (
            <Button key={d} size="sm" variant={d === days ? "default" : "outline"} onClick={() => setDays(d)}>{d} days</Button>))}</span>
        </CardTitle>
        <p className="text-sm text-muted-foreground">Totals only – you can't open another company's leads, customers or quotes.</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {error && <p className="text-sm text-destructive">Couldn't load network totals.</p>}
        {!error && !data && <p className="text-sm text-muted-foreground">Loading…</p>}
        {data?.map((c) => (
          <div key={c.company_id} className="rounded-md border p-3" data-testid="network-company">
            <div className="flex items-center gap-2 font-medium"><span className="truncate">{c.name}</span>{c.is_master && <span className="text-xs rounded bg-primary/10 px-1.5 py-0.5 text-primary">You</span>}
              <span className="ml-auto text-sm text-muted-foreground">{c.people} people</span></div>
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-5 gap-2 text-sm">
              <div><div className="text-muted-foreground text-xs">New leads</div>{c.leads_new}</div>
              <div><div className="text-muted-foreground text-xs">Quotes sent</div>{c.quotes_sent}</div>
              <div><div className="text-muted-foreground text-xs">Won</div>{c.quotes_accepted} · {winRate(c)}</div>
              <div><div className="text-muted-foreground text-xs">Won value</div>{rand(c.accepted_value)}</div>
              <div><div className="text-muted-foreground text-xs">Jobs booked</div>{c.jobs_booked}</div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
