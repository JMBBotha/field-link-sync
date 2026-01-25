import { cn } from "@/lib/utils";

export type LeadStatusFilter = "pending" | "accepted" | "in_progress" | "completed";

interface StatusFilterButtonsProps {
  activeFilters: Set<LeadStatusFilter>;
  onToggle: (status: LeadStatusFilter) => void;
  className?: string;
  compact?: boolean;
}

const statusConfig: Record<LeadStatusFilter, { label: string; bgColor: string; textColor: string; inactiveText: string }> = {
  pending: {
    label: "Available",
    bgColor: "bg-red-500",
    textColor: "text-white",
    inactiveText: "text-red-600",
  },
  accepted: {
    label: "Claimed",
    bgColor: "bg-yellow-500",
    textColor: "text-black",
    inactiveText: "text-yellow-600",
  },
  in_progress: {
    label: "In Progress",
    bgColor: "bg-green-500",
    textColor: "text-white",
    inactiveText: "text-green-600",
  },
  completed: {
    label: "Completed",
    bgColor: "bg-black dark:bg-white",
    textColor: "text-white dark:text-black",
    inactiveText: "text-black dark:text-white",
  },
};

const StatusFilterButtons = ({
  activeFilters,
  onToggle,
  className,
  compact = false,
}: StatusFilterButtonsProps) => {
  const statuses: LeadStatusFilter[] = ["pending", "accepted", "in_progress", "completed"];

  return (
    <div
      className={cn(
        "bg-card/95 backdrop-blur-md border border-border/50 rounded-full px-1.5 py-1.5 shadow-lg flex items-center gap-1",
        className
      )}
    >
      {statuses.map((status) => {
        const config = statusConfig[status];
        const isActive = activeFilters.has(status);

        return (
          <button
            key={status}
            onClick={() => onToggle(status)}
            className={cn(
              "relative flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold",
              "transition-all duration-300 ease-out transform",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              isActive
                ? `${config.bgColor} ${config.textColor} shadow-md scale-100`
                : `bg-transparent ${config.inactiveText} hover:bg-muted/50 scale-95 opacity-70 hover:opacity-100 hover:scale-100`
            )}
          >
            {/* Indicator dot with pulse animation when active */}
            <span
              className={cn(
                "w-2 h-2 rounded-full transition-all duration-300",
                isActive
                  ? "bg-current opacity-80 scale-100"
                  : "bg-current opacity-40 scale-75"
              )}
            />
            
            {/* Label with slide effect */}
            <span
              className={cn(
                "transition-all duration-300 ease-out",
                isActive ? "translate-x-0" : "-translate-x-0.5",
                compact ? "hidden sm:inline" : ""
              )}
            >
              {config.label}
            </span>

            {/* Active indicator glow effect */}
            {isActive && (
              <span
                className={cn(
                  "absolute inset-0 rounded-full opacity-20 blur-sm -z-10",
                  config.bgColor
                )}
              />
            )}
          </button>
        );
      })}
    </div>
  );
};

export default StatusFilterButtons;
