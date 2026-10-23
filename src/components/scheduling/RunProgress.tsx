import { cn } from "@/lib/utils";
import { runProgress, type JobDays } from "@/lib/jobDays";

/** Compact progress for a multi-day run: "Day 23 of 44", a bar with % done and the expected end date. Used on the tech and office screens. */
export function RunProgressBar({ data, today, className }: { data: Pick<JobDays, "days" | "day_count" | "status" | "today">; today?: string; className?: string }) {
  const p = runProgress(data, today ?? data.today);
  return (
    <div className={cn("space-y-1.5 min-w-0", className)} data-testid="run-progress">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold tabular-nums" data-testid="run-progress-headline">{p.headline}</span>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-primary" data-testid="run-progress-pct">{p.pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.pct}
        aria-label={`${p.done} of ${p.total} days done`}>
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${p.pct}%` }} />
      </div>
      <p className="text-xs text-muted-foreground" data-testid="run-progress-sub">
        {p.done} of {p.total} days done{p.missed ? ` · ${p.missed} missed` : ""}{p.sub ? ` · ${p.sub}` : ""}
      </p>
    </div>
  );
}
