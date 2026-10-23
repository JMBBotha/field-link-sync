import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, Minus, Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  pickEndDate, MAX_PICK_DAYS, QUICK_PICKS, clashGroupText, clashHeadline, clashSummaryOf, dayLabel, pickArgs, pickLabel, planSummary, previewJobDays, skipText,
  type DaysPlan, type LengthPick,
} from "@/lib/jobDays";

/**
 * Multi-day pick: "Same day" | "Multi-day" toggle, quick picks (days / weeks / months), a pick-an-end-date input,
 * a whole-days stepper (up to 130 working days ≈ 6 months) and the server plan
 * (working days only — weekends, SA holidays and closures skipped; same tech every day; clashes flagged).
 * Weeks, months and end dates are turned into a working-day count by the server (preview with p_end_date);
 * the count is what gets booked, so hand_to_technician is unchanged.
 * A clash blocks the booking; an admin can Book anyway with a reason.
 */
export interface MultiDayPickerProps {
  days: number;
  onDaysChange: (n: number) => void;
  /** Tech to check (Pick); null = offer mode, only working days are shown. */
  techId: string | null;
  date: string;
  jobId?: string | null;
  isAdmin: boolean;
  /** Offer mode: offers go only to techs free on all days. */
  offer?: boolean;
  reason: string;
  onReasonChange: (s: string) => void;
  disabled?: boolean;
}

export function useDaysPlan(techId: string | null, date: string, days: number, jobId?: string | null) {
  return useQuery({
    queryKey: ["preview-job-days", techId, date, days, jobId ?? null],
    enabled: days > 1 && !!date,
    staleTime: 15_000,
    queryFn: () => previewJobDays(techId, date, days, jobId),
  });
}

/** Plan by end date (weeks / months / until). Disabled for plain day counts. */
function useEndPlan(techId: string | null, date: string, end: string | null, jobId?: string | null) {
  return useQuery({
    queryKey: ["preview-job-days-end", techId, date, end, jobId ?? null],
    enabled: !!end && !!date && end >= date,
    staleTime: 15_000,
    queryFn: () => previewJobDays(techId, date, null, jobId, end),
  });
}

export function MultiDayPicker(p: MultiDayPickerProps) {
  const [pick, setPick] = useState<LengthPick>({ kind: "days", n: p.days });
  const end = p.date ? pickArgs(p.date, pick).end : null;
  const endPlan = useEndPlan(p.techId, p.date, end, p.jobId);
  const byDays = useDaysPlan(p.techId, p.date, p.days, p.jobId);
  const { onDaysChange } = p;
  // A weeks / months / end-date pick books the working days the server found in that span.
  useEffect(() => {
    const n = endPlan.data?.day_count;
    if (pick.kind !== "days" && n && n !== p.days) onDaysChange(Math.max(2, Math.min(MAX_PICK_DAYS, n)));
  }, [endPlan.data?.day_count, pick.kind, p.days, onDaysChange]);
  const usingEnd = pick.kind !== "days" && !!end;
  const q = usingEnd ? endPlan : byDays;
  const onDays = (n: number) => { setPick({ kind: "days", n }); onDaysChange(n); };
  return <MultiDayPickerView {...p} onDaysChange={onDays} pick={pick} onPick={setPick}
    plan={q.data ?? null} loading={q.isFetching} error={q.error ? (q.error as Error).message : null} />;
}

/** Book is blocked while the plan has clashes, unless an admin gives a reason. */
export function multiDayBlocked(plan: DaysPlan | null, isAdmin: boolean, reason: string): string | null {
  if (!plan) return "Checking the days…";
  if (plan.clash_days > 0) {
    if (!isAdmin) return "The technician is busy on some of these days — pick another start or technician";
    if (reason.trim().length < 3) return "Say why you are booking over the clash";
  }
  return null;
}

/** Long plans show the first few days and fold the rest away (clash days always stay visible in the summary). */
const PLAN_FOLD = 7;
const PLAN_HEAD = 5;

export function MultiDayPickerView({ days, onDaysChange, techId, date, isAdmin, offer, reason, onReasonChange, disabled, plan, loading, error, pick, onPick }:
  MultiDayPickerProps & { plan: DaysPlan | null; loading?: boolean; error?: string | null; pick?: LengthPick; onPick?: (p: LengthPick) => void }) {
  const multi = days > 1;
  const [showAll, setShowAll] = useState(false);
  const set = (n: number) => !disabled && onDaysChange(Math.max(1, Math.min(MAX_PICK_DAYS, n)));
  const choose = (p: LengthPick) => {
    if (disabled) return;
    if (p.kind === "days") set(p.n); else onPick?.(p);
  };
  const active = (p: LengthPick) => !!pick && pick.kind === p.kind && (p.kind === "until" || (pick.kind !== "until" && pick.n === p.n))
    && (p.kind !== "days" || days === p.n);
  const until = pick && pick.kind !== "days" && date ? pickEndDate(date, pick) ?? "" : "";
  const summary = plan ? clashSummaryOf(plan) : null;
  const long = (plan?.days.length ?? 0) > PLAN_FOLD;
  const shown = plan ? (long && !showAll ? plan.days.slice(0, PLAN_HEAD) : plan.days) : [];
  const heading = pick && pick.kind !== "days" ? `${pickLabel(pick)} · ${days} working days` : `${days} full days`;
  return (
    <div className="space-y-2 min-w-0" data-testid="multi-day-picker">
      <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Job length">
        {[{ k: false, label: "Same day" }, { k: true, label: "Multi-day" }].map((o) => (
          <button key={o.label} type="button" role="radio" aria-checked={multi === o.k} disabled={disabled}
            onClick={() => set(o.k ? Math.max(2, days) : 1)} data-testid={o.k ? "days-multi" : "days-single"}
            className={cn("h-10 rounded-lg border text-sm font-medium transition-colors",
              multi === o.k ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-muted")}>
            {o.label}
          </button>
        ))}
      </div>
      {multi && (
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-2.5 min-w-0">
          {onPick && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick picks" data-testid="days-quick">
              {QUICK_PICKS.map((q) => (
                <button key={q.key} type="button" disabled={disabled} onClick={() => choose(q.pick)} data-testid={`days-quick-${q.key}`}
                  aria-pressed={active(q.pick)}
                  className={cn("h-8 rounded-full border px-3 text-xs font-medium transition-colors",
                    active(q.pick) ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-muted")}>
                  {q.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" aria-label="One day less" disabled={disabled || days <= 2} onClick={() => set(days - 1)}
              className="h-10 w-10 shrink-0 rounded-lg border border-border bg-background flex items-center justify-center hover:bg-muted disabled:opacity-40">
              <Minus className="h-4 w-4" />
            </button>
            <div className="min-w-[6rem] flex-1 text-center">
              <div className="text-base font-semibold tabular-nums" data-testid="days-value">{heading}</div>
              <div className="text-xs text-muted-foreground">company hours each day</div>
            </div>
            <button type="button" aria-label="One day more" disabled={disabled || days >= MAX_PICK_DAYS} onClick={() => set(days + 1)}
              className="h-10 w-10 shrink-0 rounded-lg border border-border bg-background flex items-center justify-center hover:bg-muted disabled:opacity-40">
              <Plus className="h-4 w-4" />
            </button>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          {onPick && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="shrink-0">Or until</span>
              <Input type="date" value={until} min={date || undefined} disabled={disabled || !date} data-testid="days-until"
                onChange={(e) => e.target.value && onPick({ kind: "until", end: e.target.value })} className="h-9 min-w-0 flex-1 bg-background text-sm" />
            </label>
          )}
          {!date ? <p className="text-xs text-muted-foreground">Choose a start date to see the days.</p>
            : error ? <p className="text-xs text-destructive" data-testid="days-error">{error}</p>
            : plan && (
              <>
                <p className="flex items-center gap-1.5 text-sm font-medium" data-testid="days-summary">
                  <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />{planSummary(plan)}
                </p>
                <ul className="space-y-1" data-testid="days-plan">
                  {shown.map((d) => {
                    const clash = (d.clashes?.length ?? 0) > 0;
                    return (
                      <li key={d.date} className={cn("flex items-start justify-between gap-2 rounded-md px-2 py-1.5 text-sm",
                        clash ? "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200" : "bg-background")}
                        data-testid={clash ? "days-plan-clash" : "days-plan-day"}>
                        <span className="min-w-0">
                          <span className="font-medium">Day {d.day_index}</span> · {dayLabel(d.date)}
                          {clash && <span className="block text-xs break-words">Busy: {d.clashes!.map((c) => `${c.start}–${c.end} ${c.label}`).join(", ")}</span>}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">{d.start}–{d.end}</span>
                      </li>
                    );
                  })}
                </ul>
                {long && (
                  <button type="button" className="text-xs font-medium text-primary underline-offset-2 hover:underline" data-testid="days-plan-toggle"
                    onClick={() => setShowAll((v) => !v)}>
                    {showAll ? "Show fewer days" : `+ ${plan.days.length - PLAN_HEAD} more days · show all`}
                  </button>
                )}
                {plan.skipped.length > 0 && (
                  <p className="text-xs text-muted-foreground" data-testid="days-skipped">
                    Skipped: {plan.skipped.length > 8
                      ? `${plan.skipped.filter((s) => /weekend/i.test(s.reason)).length} weekend days, ${plan.skipped.filter((s) => !/weekend/i.test(s.reason)).map(skipText).join(" · ") || "no holidays"}`
                      : plan.skipped.map(skipText).join(" · ")}
                  </p>
                )}
                {plan.holidays_unknown && (
                  <p className="text-xs text-amber-800 dark:text-amber-300" data-testid="days-holidays-unknown">
                    Public holidays are only loaded up to {plan.holidays_known_until ? dayLabel(plan.holidays_known_until) + " " + plan.holidays_known_until.slice(0, 4) : "now"} — check the later days.
                  </p>
                )}
                {offer ? <p className="text-xs text-muted-foreground" data-testid="days-offer-hint">
                    Offers go only to technicians who are free on all {plan.day_count} days.
                    {plan.day_count > 10 && " For a long job few technicians are free every day — Pick a technician instead."}
                  </p>
                  : !techId && <p className="text-xs text-muted-foreground">Pick a technician to check they are free every day.</p>}
                {plan.clash_days > 0 && (
                  <div className="space-y-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200" data-testid="days-clash">
                    <p className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{summary ? clashHeadline(summary, plan.day_count) : `Busy on ${plan.clash_days} of the ${plan.day_count} days`}.{" "}
                        {isAdmin ? "You can book anyway — say why:" : "Pick another start date or technician, or ask an admin."}</span></p>
                    {summary && (long || summary.by_label.length > 1) && (
                      <ul className="space-y-0.5 pl-5" data-testid="days-clash-groups">
                        {summary.by_label.map((g) => <li key={g.label} className="break-words">{clashGroupText(g)}</li>)}
                        {summary.more_labels > 0 && <li>+ {summary.more_labels} more bookings</li>}
                      </ul>
                    )}
                    {summary && long && (
                      <p className="pl-5" data-testid="days-clash-dates">
                        {summary.dates.map(dayLabel).join(", ")}{summary.more_dates > 0 ? ` + ${summary.more_dates} more` : ""}
                      </p>
                    )}
                    {isAdmin && (
                      <Input value={reason} onChange={(e) => onReasonChange(e.target.value)} placeholder="Reason for booking over the clash"
                        className="h-9 bg-background text-sm" data-testid="days-override-reason" />
                    )}
                  </div>
                )}
              </>
            )}
        </div>
      )}
    </div>
  );
}

export default MultiDayPicker;
