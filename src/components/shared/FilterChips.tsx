import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ActiveChip = { key: string; label: string };

/** "N shown" + clearable active filter chips + Clear all. Wraps on mobile. */
const FilterChips = ({ shown, chips, onClear, onClearAll }: {
  shown: number; chips: ActiveChip[]; onClear: (key: string) => void; onClearAll: () => void;
}) => (
  <div className="flex flex-wrap items-center gap-2">
    <span className="text-sm font-medium text-foreground">{shown} shown</span>
    {chips.map((c) => (
      <Button key={c.key} variant="secondary" size="sm" className="h-8 max-w-full gap-1.5 rounded-full text-xs"
        onClick={() => onClear(c.key)} aria-label={`Clear ${c.label}`}>
        <span className="truncate">{c.label}</span> <X className="h-3 w-3 shrink-0" />
      </Button>
    ))}
    {chips.length > 0 && (
      <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={onClearAll}>Clear all</Button>
    )}
  </div>
);

export default FilterChips;
