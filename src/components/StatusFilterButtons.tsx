import { cn } from "@/lib/utils";

export type LeadStatusFilter = "pending" | "accepted" | "in_progress" | "completed";

interface StatusFilterButtonsProps {
  activeFilters: Set<LeadStatusFilter>;
  onToggle: (status: LeadStatusFilter) => void;
  className?: string;
  compact?: boolean;
}

const statusConfig: Record<LeadStatusFilter, { label: string; color: string; activeColor: string; textColor: string }> = {
  pending: {
    label: "Available",
    color: "bg-red-500",
    activeColor: "bg-red-500",
    textColor: "text-white",
  },
  accepted: {
    label: "Claimed",
    color: "bg-yellow-500",
    activeColor: "bg-yellow-500",
    textColor: "text-black",
  },
  in_progress: {
    label: "In Progress",
    color: "bg-green-500",
    activeColor: "bg-green-500",
    textColor: "text-white",
  },
  completed: {
    label: "Completed",
    color: "bg-black",
    activeColor: "bg-black",
    textColor: "text-white",
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
        "bg-card/95 backdrop-blur border rounded-full px-3 py-2 shadow-lg flex items-center gap-2",
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
              "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all",
              "border-2",
              isActive
                ? `${config.activeColor} ${config.textColor} border-transparent shadow-md`
                : "bg-card border-muted-foreground/30 text-muted-foreground hover:border-muted-foreground/50"
            )}
          >
            <div
              className={cn(
                "w-2.5 h-2.5 rounded-full border border-white/50",
                isActive ? "opacity-0" : config.color
              )}
            />
            {!compact && <span>{config.label}</span>}
            {compact && (
              <span className="hidden sm:inline">{config.label}</span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default StatusFilterButtons;
