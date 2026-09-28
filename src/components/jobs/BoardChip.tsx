import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/** Small chip inside a clickable board card: acts as a filter, never opens the card. */
const BoardChip = ({ onSelect, className, children, label }: { onSelect: () => void; className?: string; children: ReactNode; label: string }) => (
  <button
    type="button"
    aria-label={label}
    onClick={(e) => { e.stopPropagation(); e.preventDefault(); onSelect(); }}
    onKeyDown={(e) => e.stopPropagation()}
    className={cn("inline-flex max-w-full items-center truncate rounded-full border px-2 py-0.5 text-[11px] font-medium hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
  >
    <span className="truncate">{children}</span>
  </button>
);

export default BoardChip;
