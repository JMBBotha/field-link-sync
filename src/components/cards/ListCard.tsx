import type { HTMLAttributes, KeyboardEvent, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * R2 one list card: title, one subject line (chip · amount · date), chevron opens the record.
 * Callers decide whether `amount` is passed, so role money-hiding stays with them.
 */
export type ListCardProps = Omit<HTMLAttributes<HTMLDivElement>, "title" | "onClick"> & {
  title: ReactNode;
  chip?: ReactNode;
  amount?: ReactNode | null;
  date?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  onOpen: () => void;
  /** Title + amount on line 1, chips wrapping underneath (no clipping at 390px). */
  stacked?: boolean;
};

export default function ListCard({ title, chip, amount, date, leading, trailing, onOpen, className, stacked, ...rest }: ListCardProps) {
  const key = (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } };
  return (
    <div role="link" tabIndex={0} data-list-card onClick={onOpen} onKeyDown={key} {...rest}
      className={cn("flex min-h-[56px] cursor-pointer items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-2.5 shadow-sm transition-colors hover:bg-muted/40 active:bg-muted/60", className)}>
      {leading && <div className="shrink-0" onClick={(e) => e.stopPropagation()}>{leading}</div>}
      {stacked ? (
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <div className="min-w-0 flex-1 truncate text-base font-semibold text-ink">{title}</div>
          {amount != null && amount !== "" && <span className="shrink-0 whitespace-nowrap text-base font-semibold tabular-nums text-ink" data-list-card-amount>{amount}</span>}
        </div>
        {chip && <div className="mt-1 flex flex-wrap items-center gap-1.5">{chip}</div>}
        {date && <div className="mt-0.5 truncate text-xs text-ink-secondary">{date}</div>}
      </div>
      ) : (
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-semibold text-ink">{title}</div>
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-sm text-ink-secondary">
          {chip}
          {amount != null && amount !== "" && <span className="shrink-0 font-semibold tabular-nums text-ink" data-list-card-amount>{amount}</span>}
          {date && <span className="truncate">{date}</span>}
        </div>
      </div>
      )}
      {trailing && <div className={cn("shrink-0", stacked && "self-start")} onClick={(e) => e.stopPropagation()}>{trailing}</div>}
      <ChevronRight className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden />
    </div>
  );
}
