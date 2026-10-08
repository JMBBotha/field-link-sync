import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AttentionChip<K extends string = string> = {
  key: K; n: number; label: string; tone: "red" | "orange" | "yellow" | "blue"; to?: string;
};
const TONES = {
  red: "border-destructive/40 bg-destructive/10 text-destructive",
  orange: "border-warning/40 bg-warning/10 text-warning-foreground",
  yellow: "border-warning/40 bg-warning/10 text-warning-foreground",
  blue: "border-info/40 bg-info/10 text-info",
};

/** Shared attention presentation; filtering and destinations stay with callers. */
export default function AttentionChips<K extends string>({ chips, onChipClick, activeKey, className,
  ...rest }: { chips: AttentionChip<K>[]; onChipClick?: (key: K) => void; activeKey?: K | null; className?: string; "data-testid"?: string }) {
  return (
    <div {...rest} className={cn("flex flex-wrap items-center gap-1.5 rounded-xl border bg-card px-3 py-2", className)}>
      <span className="mr-1 text-xs font-bold tracking-wide text-muted-foreground">⚠ NEEDS ATTENTION</span>
      {chips.length === 0 ? <span className="text-xs text-success">All clear</span> : chips.map((c) => {
        const cls = cn("h-auto rounded-full border px-2.5 py-0.5 text-xs font-medium hover:underline", TONES[c.tone], activeKey === c.key && "ring-2 ring-ring ring-offset-1");
        const label = <><b>{c.n}</b> {c.label}</>;
        return c.to && !onChipClick
          ? <Button key={c.key} asChild variant="ghost" className={cls}><Link to={c.to}>{label}</Link></Button>
          : <Button key={c.key} variant="ghost" className={cls} aria-pressed={activeKey === c.key} onClick={() => onChipClick?.(c.key)}>{label}</Button>;
      })}
    </div>
  );
}