import { useRef, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export type LeadListStatus = "all" | "pending" | "accepted" | "in_progress" | "completed";

interface FilterPillConfig {
  value: LeadListStatus;
  label: string;
  bgColor: string;
  textColor: string;
  activeBg: string;
}

const filterConfigs: FilterPillConfig[] = [
  { value: "all", label: "All", bgColor: "bg-muted", textColor: "text-foreground", activeBg: "bg-primary" },
  { value: "pending", label: "Available", bgColor: "bg-red-500/20", textColor: "text-red-700", activeBg: "bg-red-500" },
  { value: "accepted", label: "Claimed", bgColor: "bg-yellow-500/20", textColor: "text-yellow-700", activeBg: "bg-yellow-500" },
  { value: "in_progress", label: "In Progress", bgColor: "bg-green-500/20", textColor: "text-green-700", activeBg: "bg-green-500" },
  { value: "completed", label: "Completed", bgColor: "bg-black/20", textColor: "text-foreground", activeBg: "bg-black" },
];

interface LeadListFilterPillsProps {
  activeFilter: LeadListStatus;
  onFilterChange: (filter: LeadListStatus) => void;
  availableStatuses?: LeadListStatus[];
  counts?: Record<LeadListStatus, number>;
  className?: string;
  compact?: boolean;
}

const LeadListFilterPills = ({
  activeFilter,
  onFilterChange,
  availableStatuses = ["all", "pending", "accepted", "in_progress"],
  counts,
  className,
  compact = false,
}: LeadListFilterPillsProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);

  const visibleFilters = filterConfigs.filter((f) => availableStatuses.includes(f.value));

  // Check if we need dropdown on very narrow screens
  useEffect(() => {
    const checkWidth = () => {
      if (scrollRef.current) {
        const width = scrollRef.current.offsetWidth;
        setContainerWidth(width);
        // Show dropdown if container is < 280px and we have > 3 filters
        setShowDropdown(width < 280 && visibleFilters.length > 3);
      }
    };

    checkWidth();
    window.addEventListener("resize", checkWidth);
    return () => window.removeEventListener("resize", checkWidth);
  }, [visibleFilters.length]);

  // Dropdown fallback for very narrow screens
  if (showDropdown) {
    const activeConfig = visibleFilters.find((f) => f.value === activeFilter) || visibleFilters[0];
    
    return (
      <div className={cn("w-full", className)}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "w-full justify-between gap-2 h-9",
                activeConfig.activeBg,
                activeFilter !== "all" ? "text-white" : ""
              )}
            >
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    "w-2 h-2 rounded-full",
                    activeFilter === "all" ? "bg-primary" : activeConfig.activeBg
                  )}
                />
                {activeConfig.label}
                {counts && counts[activeFilter] !== undefined && (
                  <span className="text-xs opacity-80">({counts[activeFilter]})</span>
                )}
              </span>
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48 bg-card z-50">
            {visibleFilters.map((config) => (
              <DropdownMenuCheckboxItem
                key={config.value}
                checked={activeFilter === config.value}
                onCheckedChange={() => onFilterChange(config.value)}
                className="gap-2"
              >
                <span
                  className={cn("w-2 h-2 rounded-full flex-shrink-0", config.activeBg)}
                />
                <span className="flex-1">{config.label}</span>
                {counts && counts[config.value] !== undefined && (
                  <span className="text-xs text-muted-foreground">({counts[config.value]})</span>
                )}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className={cn(
        "flex gap-1.5 overflow-x-auto scrollbar-hide pb-1 -mb-1",
        "touch-pan-x snap-x snap-mandatory",
        className
      )}
      style={{ WebkitOverflowScrolling: "touch", scrollbarWidth: "none", msOverflowStyle: "none" }}
    >
      {visibleFilters.map((config) => {
        const isActive = activeFilter === config.value;
        const count = counts?.[config.value];

        return (
          <button
            key={config.value}
            onClick={() => onFilterChange(config.value)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap snap-start",
              "transition-all duration-200 ease-out min-w-fit",
              "touch-manipulation select-none",
              // Active state
              isActive
                ? cn(
                    config.activeBg,
                    config.value === "accepted" ? "text-black" : "text-white",
                    "shadow-md scale-100"
                  )
                : cn(
                    "bg-muted/60 text-muted-foreground hover:bg-muted",
                    "scale-95 opacity-80 hover:opacity-100"
                  ),
              // Larger touch targets
              compact ? "min-h-[32px]" : "min-h-[36px]"
            )}
          >
            {/* Status indicator dot */}
            <span
              className={cn(
                "w-2 h-2 rounded-full flex-shrink-0 transition-colors",
                isActive ? "bg-white/80" : config.activeBg
              )}
            />
            <span>{config.label}</span>
            {count !== undefined && (
              <Badge
                variant="secondary"
                className={cn(
                  "h-4 px-1 text-[10px] font-normal",
                  isActive
                    ? "bg-white/20 text-inherit"
                    : "bg-muted-foreground/20 text-muted-foreground"
                )}
              >
                {count}
              </Badge>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default LeadListFilterPills;
