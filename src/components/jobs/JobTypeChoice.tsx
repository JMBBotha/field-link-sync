import { cn } from "@/lib/utils";
import { JOB_KIND_META, type JobKind } from "@/lib/jobTypeChoice";

/** Required two-card choice (no default). Keeps the V8 card look; no client names. */
export function JobTypeChoice({ value, onChange, compact = false, label = "What does the client need?" }: {
  value: JobKind | null; onChange: (k: JobKind) => void; compact?: boolean; label?: string;
}) {
  return (
    <div className="space-y-2" role="radiogroup" aria-label={label} data-testid="job-type-choice">
      <div className="text-sm font-semibold">{label} <span className="text-destructive">* required</span></div>
      {!value && <div className="text-xs text-muted-foreground">Pick one before you save. No default.</div>}
      <div className={cn("grid gap-2", compact ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-2")}>
        {(Object.keys(JOB_KIND_META) as JobKind[]).map((k) => {
          const m = JOB_KIND_META[k];
          const on = value === k;
          return (
            <button key={k} type="button" role="radio" aria-checked={on} onClick={() => onChange(k)} data-testid={`job-kind-${k}`}
              className={cn("text-left rounded-xl border-2 p-3 transition-colors bg-card",
                on ? "border-orange-600 ring-2 ring-orange-200" : "border-border hover:border-muted-foreground/40")}>
              <div className="text-2xl leading-none">{m.icon}</div>
              <div className="font-semibold mt-1">{m.title}</div>
              {!compact && <>
                <span className={cn("inline-block mt-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                  k === "service" ? "bg-blue-100 text-blue-800" : "bg-green-100 text-green-800")}>Request type: {m.requestLabel}</span>
                <div className="text-xs text-muted-foreground mt-1">{m.hint}</div>
                <div className={cn("text-xs mt-2 rounded-lg border p-2",
                  k === "service" ? "bg-orange-50 border-orange-300" : "bg-green-50 border-green-300")}>{m.note}</div>
                <div className="text-[11px] text-muted-foreground mt-1">{m.next}</div>
              </>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
