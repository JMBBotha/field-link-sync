/** Tech "My earnings" summary card (/field) and full view (/field/earnings). Own labour share only. */
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, CheckCircle2, ChevronRight, Clock, Loader2, Minus, MinusCircle, PiggyBank, ShieldCheck, Sparkles, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatRand } from "@/utils/formatRand";
import { formatSastDate } from "@/lib/salesTracker";
import { BUCKET_LABEL, bucketOf, jobsByWeek, lastWeeks, monthCompare, summarizeMine, type MyEarningRow } from "@/lib/myEarnings";
import { cn } from "@/lib/utils";
import { PeekCard, usePeekStack } from "@/components/shared/CardStack";

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

const CHIP: Record<string, { cls: string; Icon: typeof Clock }> = {
  pending: { cls: "bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-500/15 dark:text-amber-200", Icon: Clock },
  paid: { cls: "bg-emerald-100 text-emerald-800 ring-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-200", Icon: CheckCircle2 },
  held: { cls: "bg-sky-100 text-sky-800 ring-sky-300 dark:bg-sky-500/15 dark:text-sky-200", Icon: ShieldCheck },
  reduced: { cls: "bg-muted text-muted-foreground ring-border", Icon: MinusCircle },
};
const dayBadge = (d: string | null) => {
  if (!d) return { day: "—", mon: "" };
  const dt = new Date(`${d}T12:00:00`);
  return { day: String(dt.getDate()), mon: dt.toLocaleDateString("en-ZA", { month: "short" }) };
};
const weekLabel = (start: string) => start === "undated" ? "Date to be set" : `Week of ${formatSastDate(start)}`;

/** Big Back: previous screen, or /field when opened directly. */
export function BigBack() {
  const navigate = useNavigate();
  const back = () => ((window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate("/field"));
  return (
    <Button onClick={back} variant="outline" className="h-12 gap-2 border-emerald-600 px-5 text-base font-semibold text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300" data-testid="earn-back">
      <ArrowLeft className="h-5 w-5" /> Back
    </Button>
  );
}

function Hero({ rows }: { rows: MyEarningRow[] }) {
  const c = monthCompare(rows);
  const s = summarizeMine(rows);
  const Trend = c.trend === "up" ? TrendingUp : c.trend === "down" ? TrendingDown : Minus;
  return (
    <div className="rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-800 p-4 text-white shadow-lg" data-testid="earn-hero">
      <p className="text-sm text-emerald-100">This month</p>
      <p className="text-4xl font-extrabold tabular-nums" data-testid="earn-month">{money(c.current)}</p>
      <p className="mt-1 flex items-center gap-1 text-sm text-emerald-50" data-testid="earn-trend">
        <Trend className="h-4 w-4" />
        {c.last === 0 && c.current === 0 ? "Nothing yet this month"
          : c.trend === "same" ? "Same as last month"
          : `${money(Math.abs(c.diff))} ${c.trend === "up" ? "more" : "less"} than last month`}
      </p>
      <p className="mt-2 text-xs text-emerald-100">This week <b className="tabular-nums text-white" data-testid="earn-week">{money(s.week)}</b></p>
    </div>
  );
}

function WeekBars({ rows }: { rows: MyEarningRow[] }) {
  const weeks = lastWeeks(rows, 8);
  const max = Math.max(...weeks.map((w) => w.total), 1);
  return (
    <Card className="surface-card-solid"><CardContent className="p-3">
      <p className="mb-2 text-sm font-semibold">Last 8 weeks</p>
      <div className="flex h-28 items-end gap-1.5" data-testid="earn-bars" role="img" aria-label="Earnings per week, last 8 weeks">
        {weeks.map((w, i) => (
          <div key={w.start} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${weekLabel(w.start)}: ${money(w.total)}`}>
            <div className={cn("w-full rounded-t-md", i === weeks.length - 1 ? "bg-emerald-600" : "bg-emerald-300 dark:bg-emerald-700")}
              style={{ height: `${Math.max(4, (w.total / max) * 100)}%` }} />
            <span className="text-[9px] text-muted-foreground">{dayBadge(w.start).day} {dayBadge(w.start).mon}</span>
          </div>
        ))}
      </div>
    </CardContent></Card>
  );
}

function StatusChips({ rows }: { rows: MyEarningRow[] }) {
  const s = summarizeMine(rows);
  const items: [string, string, number][] = [["pending", "Pending", s.pending], ["paid", "Paid", s.paid], ["held", "Retention held", s.held]];
  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map(([k, label, v]) => { const { cls, Icon } = CHIP[k]; return (
        <div key={k} className={cn("rounded-xl p-2 ring-1", cls)} data-testid={`earn-${k}`}>
          <p className="flex items-center gap-1 text-[11px] font-medium"><Icon className="h-3.5 w-3.5 shrink-0" />{label}</p>
          <p className="text-sm font-bold tabular-nums sm:text-base">{money(v)}</p>
        </div>
      ); })}
    </div>
  );
}

export function MyEarningsView() {
  const { data: rows = [], isLoading } = useMyTechEarnings();
  return (
    <div className="space-y-3" data-testid="my-earnings">
      <BigBack />
      {isLoading && <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin" /></div>}
      {!isLoading && rows.length === 0 && (
        <Card className="surface-card-solid"><CardContent className="flex flex-col items-center gap-3 p-8 text-center" data-testid="earn-empty">
          <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/15">
            <PiggyBank className="h-10 w-10 text-emerald-600" />
            <Sparkles className="absolute -right-1 -top-1 h-6 w-6 text-amber-400" />
          </div>
          <p className="text-base font-semibold">No earnings yet</p>
          <p className="max-w-xs text-sm text-muted-foreground">{EMPTY}</p>
        </CardContent></Card>
      )}
      {!isLoading && rows.length > 0 && (
        <>
          <Hero rows={rows} />
          <StatusChips rows={rows} />
          <WeekBars rows={rows} />
          <p className="text-[11px] text-muted-foreground">Your share of the labour only: part is paid when the job is completed, and a retention is held and released later unless there's a callback.</p>
          <div className="space-y-4" data-testid="earn-jobs">
            {jobsByWeek(rows).map((g) => (
              <section key={g.start} className="space-y-2" data-testid="earn-week-group">
                <div className="flex items-baseline justify-between"><h2 className="text-sm font-semibold">{weekLabel(g.start)}</h2><span className="text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{money(g.total)}</span></div>
                {g.jobs.map((j) => { const d = dayBadge(j.job_date); return (
                  <Card key={j.key} className="surface-card-solid overflow-hidden">
                    <CardContent className="flex gap-3 p-3">
                      <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-emerald-600 text-white">
                        <span className="text-lg font-bold leading-none">{d.day}</span><span className="text-[10px] uppercase">{d.mon}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate text-sm font-medium">{j.job_name}</p>
                          <span className="shrink-0 whitespace-nowrap font-bold tabular-nums">{money(j.total)}</span>
                        </div>
                        <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><Clock className="h-3 w-3" />{j.hours != null ? `${j.hours} h` : "hours —"}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {j.parts.map((p) => { const b = bucketOf(p); const { cls, Icon } = CHIP[b]; return (
                            <span key={p.row_key} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1", cls)}>
                              <Icon className="h-3 w-3" />{p.kind === "retention" ? "Retention" : "On completion"} {money(p.amount)} · {BUCKET_LABEL[b]}
                              {b === "held" && p.release_after ? ` until ${formatSastDate(p.release_after)}` : ""}
                            </span>
                          ); })}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ); })}
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Collapsed-by-default earnings strip (this month's total); opens on hover (desktop) or click/tap (pinned). */
export function MyEarningsPeek({ className, overlapBelow }: { className?: string; overlapBelow?: boolean }) {
  const { data: rows = [], isLoading } = useMyTechEarnings();
  const peek = usePeekStack<"earnings">();
  const open = peek.isOpen("earnings");
  const month = summarizeMine(rows).month;
  return (
    <PeekCard id="earnings" open={open} onToggle={() => peek.toggle("earnings")}
      onPointerEnter={peek.enter("earnings")} onPointerLeave={peek.leave("earnings")}
      overlap={overlapBelow ? "below" : "none"} className={cn("shrink-0", className)}
      title={<><Wallet className="h-3.5 w-3.5 shrink-0 text-green-600" />My earnings</>}
      summary={<span className="text-[11px] font-normal text-muted-foreground" data-testid="earn-strip-month">
        {isLoading ? "…" : rows.length ? <>This month <b className="text-foreground">{money(month)}</b></> : "None yet"}</span>}>
      <div className="space-y-2 px-2 pb-4 pt-1" data-testid="my-earnings-card">
        {isLoading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" />
          : rows.length === 0 ? <p className="text-xs text-muted-foreground" data-testid="earn-empty">{EMPTY}</p>
          : <Totals rows={rows} compact />}
        <Link to="/field/earnings" className="flex items-center justify-end text-xs text-primary hover:underline">All my earnings <ChevronRight className="h-3 w-3" /></Link>
      </div>
    </PeekCard>
  );
}
