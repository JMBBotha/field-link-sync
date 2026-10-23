import { Minus, Plus, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCompanyHours, type CompanyHoursInfo } from "@/hooks/useCompanyHours";
import { describeDuration, durationChips, formatDuration, maxMinutesFrom, stepDuration } from "@/lib/durationOptions";

export interface DurationPickerProps {
  /** Minutes. */
  value: number;
  onChange: (minutes: number) => void;
  /** "HH:mm" start; enables "ends HH:mm" and after-hours warnings. */
  startTime?: string | null;
  /** Where the current value came from, e.g. "Default 3 h" or "From quote labour". */
  hint?: string | null;
  label?: string;
  disabled?: boolean;
  className?: string;
  /** Override company hours (tests / harness). */
  hours?: CompanyHoursInfo;
}

/**
 * Shared V8 duration picker: 1h / 2h / 4h / Full day chips + half-hour stepper,
 * "ends HH:mm" and an after-hours warning. Single day only — Multi-day arrives in phase (b).
 */
export function DurationPicker(props: DurationPickerProps) {
  const companyHours = useCompanyHours();
  return <DurationPickerView {...props} hours={props.hours ?? companyHours} />;
}

export function DurationPickerView({ value, onChange, startTime, hint, label = "Duration", disabled, className, hours }: DurationPickerProps & { hours: CompanyHoursInfo }) {
  const chips = durationChips(hours.fullDayMinutes);
  const max = maxMinutesFrom(startTime);
  const { end, warnings } = describeDuration({ start: startTime, minutes: value, workStart: hours.workStart, workEnd: hours.workEnd, fullDayMinutes: hours.fullDayMinutes });
  const set = (m: number) => !disabled && onChange(Math.min(max, m));

  return (
    <div className={cn("space-y-2 min-w-0", className)} data-testid="duration-picker">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</label>
        {hint && <span className="text-xs text-muted-foreground truncate" data-testid="duration-hint">{hint}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
        {chips.map((c) => {
          const on = value === c.minutes;
          return (
            <button key={c.key} type="button" role="radio" aria-checked={on} disabled={disabled || c.minutes > max}
              onClick={() => set(c.minutes)}
              className={cn("h-10 px-3 rounded-lg text-sm font-medium border transition-colors disabled:opacity-40",
                on ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-muted")}>
              {c.label}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Half an hour less" disabled={disabled || value <= 30}
          onClick={() => set(stepDuration(value, -1, max))}
          className="h-10 w-10 shrink-0 rounded-lg border border-border bg-background flex items-center justify-center hover:bg-muted disabled:opacity-40">
          <Minus className="h-4 w-4" />
        </button>
        <div className="min-w-[5.5rem] text-center">
          <div className="text-base font-semibold tabular-nums" data-testid="duration-value">{formatDuration(value)}</div>
          {end && <div className="text-xs text-muted-foreground" data-testid="duration-ends">ends {end}</div>}
        </div>
        <button type="button" aria-label="Half an hour more" disabled={disabled || value >= max}
          onClick={() => set(stepDuration(value, 1, max))}
          className="h-10 w-10 shrink-0 rounded-lg border border-border bg-background flex items-center justify-center hover:bg-muted disabled:opacity-40">
          <Plus className="h-4 w-4" />
        </button>
      </div>
      {warnings.map((w) => (
        <p key={w.kind} className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200" data-testid={`duration-warning-${w.kind}`}>
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />{w.text}
        </p>
      ))}
    </div>
  );
}

export default DurationPicker;
