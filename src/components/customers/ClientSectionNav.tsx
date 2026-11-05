import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { clientTabChipClass, type ClientTabChip } from "@/lib/clientTabChips";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";

/** Section chips for the client record. Placement is the caller's job — this is the row only. */
export default function ClientSectionNav({
  chips,
  active,
  onSelect,
  more,
  moreLabel,
}: {
  chips: ClientTabChip[];
  active: string;
  onSelect: (key: string) => void;
  more: { key: string; label: string }[];
  moreLabel?: string;
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist">
      {chips.map((chip) => {
        const selected = active === chip.key;
        return (
          <button
            key={chip.key}
            type="button"
            role="tab"
            aria-selected={selected}
            data-testid={`client-tab-${chip.key}`}
            data-weight={chip.weight}
            data-money={chip.money ? "true" : undefined}
            onClick={() => onSelect(chip.key)}
            className={clientTabChipClass(selected, chip)}
          >
            <span>{chip.label}</span>
            {chip.count ? <span className="tabular-nums">{chip.count}</span> : null}
            {chip.cue ? <span className="tabular-nums">· {chip.cue}</span> : null}
          </button>
        );
      })}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="client-more-tabs"
            data-weight="quiet"
            className={cn(clientTabChipClass(!!moreLabel, { weight: "quiet" }), "inline-flex")}
          >
            {moreLabel || "More"} <ChevronDown className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {more.map((item) => (
            <DropdownMenuItem key={item.key} data-testid={`tab-${item.key}`} onClick={() => onSelect(item.key)}>
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
