import type { HTMLAttributes, ReactNode } from "react";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import RowMenu, { type RowMenuItem } from "@/components/shared/RowMenu";
import { cn } from "@/lib/utils";
import { FLAG_META, fmtRand, type Deal, type PipeQuote } from "@/lib/quotePipeline";

type CardQuote = PipeQuote & {
  customer_name?: string | null;
  quote_number?: string | null;
  customers?: { name: string | null; area: string | null; city: string | null } | null;
};
export type QuoteCardProps = Omit<HTMLAttributes<HTMLDivElement>, "onClick"> & {
  deal: Deal<CardQuote>; repName?: string | null; onOpen: () => void; onBook?: () => void;
  menuItems?: RowMenuItem[]; action?: ReactNode; density?: "full" | "compact"; showRep?: boolean;
};
const TONE = {
  red: "border-red-300 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-200",
  orange: "border-orange-300 bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-200",
  yellow: "border-yellow-300 bg-yellow-50 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-200",
};
const initials = (n?: string | null) => (n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");

/** Presentation only: callers own navigation, actions and drag state. */
export default function QuoteCard({ deal: d, repName, onOpen, onBook, menuItems = [], action,
  density = "full", showRep = true, className, ...rest }: QuoteCardProps) {
  const red = d.flags.some((f) => FLAG_META[f].tone === "red");
  return (
    <div {...rest} onClick={onOpen} data-deal-card data-density={density}
      className={cn("min-w-0 cursor-pointer rounded-lg border bg-card p-2.5 text-left shadow-sm transition hover:shadow-md", red && "border-red-300 bg-red-50/40 dark:bg-red-950/20", className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 break-words text-sm font-semibold leading-tight">{d.quote.customers?.name || d.quote.customer_name || "No client"}</div>
        <div className="shrink-0 text-sm font-bold tabular-nums">{fmtRand(d.value)}</div>
      </div>
      <div className="mt-0.5 truncate text-xs text-muted-foreground">
        {[d.quote.customers?.area || d.quote.customers?.city, d.quote.quote_number || "no number"].filter(Boolean).join(" · ")}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {showRep && <span title={repName || "Rep"} data-rep-initials className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-[9px] font-bold text-background">{initials(repName)}</span>}
        {d.paid > 0 && <span className="rounded border border-emerald-300 bg-emerald-50 px-1.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">{fmtRand(d.paid)} PAID</span>}
        {d.partPaid && <span className="rounded border border-emerald-300 bg-emerald-50 px-1.5 text-[10px] font-bold text-emerald-700">PART PAID</span>}
        {d.depositDue && <span className="rounded border border-amber-300 bg-amber-50 px-1.5 text-[10px] font-bold text-amber-800">DEPOSIT DUE</span>}
        {d.flags.map((f) => <span key={f} className={cn("rounded border px-1.5 text-[10px] font-bold", TONE[FLAG_META[f].tone])}>{FLAG_META[f].label}</span>)}
        <span className={cn("ml-auto text-[11px] font-semibold tabular-nums", d.days > 7 ? "text-orange-600" : "text-muted-foreground")}>{d.days}d</span>
      </div>
      <div className="mt-1.5 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {action !== undefined ? action : d.stage === "accepted" && (
          <Button size="sm" className="h-7 gap-1 bg-red-600 px-2 text-xs hover:bg-red-700" onClick={onBook}>
            <CalendarPlus className="h-3.5 w-3.5" /> Book job
          </Button>
        )}
        <div className="ml-auto"><RowMenu items={menuItems} /></div>
      </div>
    </div>
  );
}