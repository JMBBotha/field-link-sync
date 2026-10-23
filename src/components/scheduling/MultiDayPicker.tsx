import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, Minus, Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { MAX_PICK_DAYS, dayLabel, planSummary, previewJobDays, skipText, type DaysPlan } from "@/lib/jobDays";

/**
 * Phase (b) multi-day pick: "Same day" | "Multi-day" toggle, a whole-days stepper and the server plan
 * (working days only — weekends, SA holidays and closures skipped; same tech every day; clashes flagged).
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

export function MultiDayPicker(p: MultiDayPickerProps) {
  const plan = useDaysPlan(p.techId, p.date, p.days, p.jobId);
  return <MultiDayPickerView {...p} plan={plan.data ?? null} loading={plan.isFetching} error={plan.error ? (plan.error as Error).message : null} />;
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

export function MultiDayPickerView({ days, onDaysChange, techId, date, isAdmin, offer, reason, onReasonChange, disabled, plan, loading, error }:
  MultiDayPickerProps & { plan: DaysPlan | null; loading?: boolean; error?: string | null }) {
  const multi = days > 1;
  const set = (n: number) => !disabled && onDaysChange(Math.max(1, Math.min(MAX_PICK_DAYS, n)));
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
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-2.5">
          <div className="flex items-center gap-2">
            <button type="button" aria-label="One day less" disabled={disabled || days <= 2} onClick={() => set(days - 1)}
              className="h-10 w-10 shrink-0 rounded-lg border border-border bg-background flex items-center justify-center hover:bg-muted disabled:opacity-40">
              <Minus className="h-4 w-4" />
            </button>
            <div className="min-w-[6rem] text-center">
              <div className="text-base font-semibold tabular-nums" data-testid="days-value">{days} full days</div>
              <div className="text-xs text-muted-foreground">company hours each day</div>
            </div>
            <button type="button" aria-label="One day more" disabled={disabled || days >= MAX_PICK_DAYS} onClick={() => set(days + 1)}
              className="h-10 w-10 shrink-0 rounded-lg border border-border bg-background flex items-center justify-center hover:bg-muted disabled:opacity-40">
              <Plus className="h-4 w-4" />
            </button>
            {loading && <Loader2 className="ml-auto h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          {!date ? <p className="text-xs text-muted-foreground">Choose a start date to see the days.</p>
            : error ? <p className="text-xs text-destructive">{error}</p>
            : plan && (
              <>
                <p className="flex items-center gap-1.5 text-sm font-medium" data-testid="days-summary">
                  <CalendarDays className="h-4 w-4 text-muted-foreground" />{planSummary(plan)}
                </p>
                <ul className="space-y-1" data-testid="days-plan">
                  {plan.days.map((d) => {
                    const clash = (d.clashes?.length ?? 0) > 0;
                    return (
                      <li key={d.date} className={cn("flex items-start justify-between gap-2 rounded-md px-2 py-1.5 text-sm",
                        clash ? "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200" : "bg-background")}
                        data-testid={clash ? "days-plan-clash" : "days-plan-day"}>
                        <span className="min-w-0">
                          <span className="font-medium">Day {d.day_index}</span> · {dayLabel(d.date)}
                          {clash && <span className="block text-xs">Busy: {d.clashes!.map((c) => `${c.start}–${c.end} ${c.label}`).join(", ")}</span>}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">{d.start}–{d.end}</span>
                      </li>
                    );
                  })}
                </ul>
                {plan.skipped.length > 0 && (
                  <p className="text-xs text-muted-foreground" data-testid="days-skipped">Skipped: {plan.skipped.map(skipText).join(" · ")}</p>
                )}
                {offer ? <p className="text-xs text-muted-foreground">Offers go only to technicians who are free on all {plan.day_count} days.</p>
                  : !techId && <p className="text-xs text-muted-foreground">Pick a technician to check they are free every day.</p>}
                {plan.clash_days > 0 && (
                  <div className="space-y-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200" data-testid="days-clash">
                    <p className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      Busy on {plan.clash_days} of the {plan.day_count} days. {isAdmin ? "You can book anyway — say why:" : "Pick another start date or technician, or ask an admin."}</p>
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
