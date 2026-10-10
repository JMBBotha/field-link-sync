/** Tech "My earnings" summary card (/field) and full view (/field/earnings). Own labour share only. */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronRight, Loader2, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatRand } from "@/utils/formatRand";
import { formatSastDate } from "@/lib/salesTracker";
import { BUCKET_LABEL, bucketOf, byJob, summarizeMine, type MyEarningRow } from "@/lib/myEarnings";
import { cn } from "@/lib/utils";

const money = (v: number) => formatRand(Number(v) || 0);

export function useMyTechEarnings() {
  return useQuery({
    queryKey: ["my-tech-earnings"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_my_tech_earnings");
      if (error) throw error;
      return (data ?? []) as MyEarningRow[];
    },
  });
}

const EMPTY = "No earnings yet. Your labour share shows here once you're assigned to an accepted job.";

function Totals({ rows, compact }: { rows: MyEarningRow[]; compact?: boolean }) {
  const s = summarizeMine(rows);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md border p-2"><p className="text-[11px] text-muted-foreground">This week</p><p className={cn("font-bold tabular-nums", compact ? "text-base" : "text-lg")} data-testid="earn-week">{money(s.week)}</p></div>
        <div className="rounded-md border p-2"><p className="text-[11px] text-muted-foreground">This month</p><p className={cn("font-bold tabular-nums", compact ? "text-base" : "text-lg")} data-testid="earn-month">{money(s.month)}</p></div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md bg-amber-500/10 p-1.5"><p className="text-[10px] text-muted-foreground">Pending</p><p className="text-sm font-semibold tabular-nums" data-testid="earn-pending">{money(s.pending)}</p></div>
        <div className="rounded-md bg-green-500/10 p-1.5"><p className="text-[10px] text-muted-foreground">Paid</p><p className="text-sm font-semibold tabular-nums" data-testid="earn-paid">{money(s.paid)}</p></div>
        <div className="rounded-md bg-sky-500/10 p-1.5"><p className="text-[10px] text-muted-foreground">Retention held</p><p className="text-sm font-semibold tabular-nums" data-testid="earn-held">{money(s.held)}</p></div>
      </div>
    </div>
  );
}

export function MyEarningsCard({ className }: { className?: string }) {
  const { data: rows = [], isLoading } = useMyTechEarnings();
  return (
    <Card className={cn("surface-card-solid", className)} data-testid="my-earnings-card">
      <CardContent className="space-y-2 p-3">
        <Link to="/field/earnings" className="flex items-center gap-2 font-semibold text-sm text-foreground hover:underline">
          <Wallet className="h-4 w-4 text-green-600" /> My earnings
          <span className="ml-auto flex items-center text-xs font-normal text-primary">Open <ChevronRight className="h-3 w-3" /></span>
        </Link>
        {isLoading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" />
          : rows.length === 0 ? <p className="text-xs text-muted-foreground" data-testid="earn-empty">{EMPTY}</p>
          : <Totals rows={rows} compact />}
      </CardContent>
    </Card>
  );
}

const BADGE: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-300", paid: "bg-green-600/15 text-green-700 dark:text-green-300",
  held: "bg-sky-500/15 text-sky-700 dark:text-sky-300", reduced: "bg-muted text-muted-foreground",
};

export function MyEarningsView() {
  const { data: rows = [], isLoading } = useMyTechEarnings();
  return (
    <div className="space-y-3" data-testid="my-earnings">
      <p className="text-[11px] text-muted-foreground">
        Your share of the labour only: part is paid when the job is completed, and a retention is held and released later unless there's a callback.
      </p>
      {isLoading && <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin" /></div>}
      {!isLoading && rows.length === 0 && (
        <Card className="surface-card-solid"><CardContent className="p-6 text-center text-sm text-muted-foreground" data-testid="earn-empty">{EMPTY}</CardContent></Card>
      )}
      {!isLoading && rows.length > 0 && (
        <>
          <Card className="surface-card-solid"><CardContent className="p-3"><Totals rows={rows} /></CardContent></Card>
          <h2 className="pt-1 text-sm font-semibold">Per job</h2>
          <div className="space-y-2" data-testid="earn-jobs">
            {byJob(rows).map((j) => (
              <Card key={j.key} className="surface-card-solid">
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{j.job_name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {j.job_date ? formatSastDate(j.job_date) : "Date to be set"} · {j.hours != null ? `${j.hours} h` : "hours —"}
                      </p>
                    </div>
                    <span className="font-semibold tabular-nums">{money(j.total)}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {j.parts.map((p) => {
                      const b = bucketOf(p);
                      return (
                        <Badge key={p.row_key} className={cn("border-0 text-[11px] font-medium", BADGE[b])}>
                          {p.kind === "retention" ? "Retention" : "On completion"}: {money(p.amount)} · {BUCKET_LABEL[b]}
                          {b === "held" && p.release_after ? ` until ${formatSastDate(p.release_after)}` : ""}
                          {b === "paid" && p.paid_at ? ` ${formatSastDate(p.paid_at)}` : ""}
                        </Badge>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
