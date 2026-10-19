import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Small shared bits for the Cash-flow health screens (V8 look: white cards, calm blue, orange/red only for alerts). */
export const Card = ({ title, right, children, className, testId }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; testId?: string }) => (
  <section className={cn("rounded-2xl border border-border bg-card p-3 md:p-4", className)} data-testid={testId}>
    {(title || right) && <div className="mb-2 flex items-center justify-between gap-2"><h2 className="text-sm font-semibold text-ink">{title}</h2>{right}</div>}
    {children}
  </section>
);

export const Chip = ({ tone = "grey", children }: { tone?: "grey" | "green" | "amber" | "red" | "blue"; children: ReactNode }) => (
  <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold",
    tone === "green" && "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
    tone === "amber" && "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
    tone === "red" && "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200",
    tone === "blue" && "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
    tone === "grey" && "bg-muted text-ink-secondary")}>{children}</span>
);

const fieldCls = "h-9 w-full rounded-lg border border-border bg-background px-2 text-sm text-ink outline-none focus:border-[#1590d6] focus:ring-2 focus:ring-[#1590d6]/20";

/** Plain fill-in field that saves when you leave it (or press Enter). */
export function Field({ value, onSave, type = "text", placeholder, className, suffix, prefix, ariaLabel, step }: {
  value: string | number | null | undefined; onSave: (v: string) => void | Promise<void>; type?: "text" | "number" | "date"; placeholder?: string; className?: string; suffix?: string; prefix?: string; ariaLabel?: string; step?: string;
}) {
  const initial = value === null || value === undefined ? "" : String(value);
  const [v, setV] = useState(initial);
  useEffect(() => setV(initial), [initial]);
  const commit = () => { if (v !== initial) void onSave(v); };
  return (
    <label className={cn("relative flex items-center", className)}>
      {prefix && <span className="pointer-events-none absolute left-2 text-xs text-ink-muted">{prefix}</span>}
      <input aria-label={ariaLabel} className={cn(fieldCls, prefix && "pl-6", suffix && "pr-7")} type={type} value={v} placeholder={placeholder} step={step}
        inputMode={type === "number" ? "decimal" : undefined} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      {suffix && <span className="pointer-events-none absolute right-2 text-xs text-ink-muted">{suffix}</span>}
    </label>
  );
}

export function Pick<T extends string>({ value, options, onChange, ariaLabel, className }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; ariaLabel?: string; className?: string }) {
  return (
    <select aria-label={ariaLabel} className={cn(fieldCls, "pr-6", className)} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export const Btn = ({ children, onClick, variant = "primary", disabled, className, testId }: { children: ReactNode; onClick?: () => void; variant?: "primary" | "outline" | "ghost"; disabled?: boolean; className?: string; testId?: string }) => (
  <button type="button" data-testid={testId} disabled={disabled} onClick={onClick}
    className={cn("inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition disabled:opacity-50",
      variant === "primary" && "bg-[#1590d6] text-white hover:bg-[#1287c9]",
      variant === "outline" && "border border-border bg-card text-ink hover:border-[#1590d6]",
      variant === "ghost" && "text-[#1590d6] hover:bg-sky-50 dark:hover:bg-sky-950/40", className)}>{children}</button>
);

export const Stat = ({ label, value, sub, tone, children, testId, className }: { label: string; value?: ReactNode; sub?: ReactNode; tone?: "red" | "green" | "amber"; children?: ReactNode; testId?: string; className?: string }) => (
  <div className={cn("rounded-2xl border border-border bg-card p-3", className)} data-testid={testId}>
    <div className="text-xs text-ink-muted">{label}</div>
    {value !== undefined && <div className={cn("text-xl font-semibold text-ink", tone === "red" && "text-red-600", tone === "green" && "text-emerald-600", tone === "amber" && "text-amber-600")}>{value}</div>}
    {sub && <div className="text-xs text-ink-muted">{sub}</div>}
    {children}
  </div>
);
