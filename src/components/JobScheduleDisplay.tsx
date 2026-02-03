import { format } from "date-fns";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface JobScheduleDisplayProps {
  scheduledDate?: string | null;
  startedAt?: string | null;
  actualStartTime?: string | null;
  completedAt?: string | null;
  estimatedEndTime?: string | null;
  estimatedDurationMinutes?: number | null;
  status: string;
  onEditClick?: () => void;
  canEdit?: boolean;
}

const formatDuration = (minutes: number): string => {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
};

const formatCompactTime = (dateStr: string): string => {
  return format(new Date(dateStr), "h:mm a");
};

const formatCompactDate = (dateStr: string): string => {
  return format(new Date(dateStr), "MMM d");
};

export function JobScheduleDisplay({
  scheduledDate,
  startedAt,
  actualStartTime,
  completedAt,
  estimatedEndTime,
  estimatedDurationMinutes,
  status,
  onEditClick,
  canEdit = false,
}: JobScheduleDisplayProps) {
  const effectiveStartTime = actualStartTime || startedAt;
  const effectiveEndTime = completedAt || estimatedEndTime;
  
  // Determine what to show based on status
  const isCompleted = status === "completed";
  const isInProgress = status === "in_progress";
  const isPending = ["pending", "open", "released", "claimed", "accepted"].includes(status);

  // Don't show if no time data at all
  if (!scheduledDate && !effectiveStartTime && !effectiveEndTime) {
    return null;
  }

  // Build compact single-line display
  const renderCompactTimeline = () => {
    // For pending/claimed jobs with scheduled date
    if (isPending && scheduledDate) {
      return (
        <span className="text-xs">
          <span className="text-muted-foreground">Scheduled: </span>
          <span className="font-medium">{format(new Date(scheduledDate), "EEE, MMM d")}</span>
        </span>
      );
    }

    // For in-progress or completed jobs
    if ((isInProgress || isCompleted) && effectiveStartTime) {
      const startTime = formatCompactTime(effectiveStartTime);
      const endTime = effectiveEndTime ? formatCompactTime(effectiveEndTime) : "--:--";
      const dateStr = effectiveEndTime 
        ? formatCompactDate(effectiveEndTime) 
        : formatCompactDate(effectiveStartTime);
      
      return (
        <div className="flex items-center gap-1.5 text-xs flex-wrap">
          {/* Status dot */}
          <div className={cn(
            "h-1.5 w-1.5 rounded-full shrink-0",
            isCompleted ? "bg-green-500" : "bg-primary"
          )} />
          
          {/* Time range */}
          <span>
            <span className="text-muted-foreground">{isCompleted ? "Completed: " : "Started: "}</span>
            <span className="font-medium">{startTime}</span>
            <span className="text-muted-foreground mx-1">→</span>
            <span className="font-medium">{endTime}</span>
            <span className="text-muted-foreground ml-1">({dateStr})</span>
          </span>
          
          {/* Duration */}
          {estimatedDurationMinutes && (
            <>
              <span className="text-muted-foreground">|</span>
              <span className="font-medium">{formatDuration(estimatedDurationMinutes)}</span>
            </>
          )}
        </div>
      );
    }

    // For completed jobs without start time, show just completion
    if (isCompleted && !effectiveStartTime && completedAt) {
      return (
        <span className="text-xs">
          <span className="text-muted-foreground">Completed: </span>
          <span className="font-medium">{format(new Date(completedAt), "MMM d 'at' h:mm a")}</span>
        </span>
      );
    }

    return null;
  };

  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-background/50">
      {/* Green dot for completed status */}
      {isCompleted && (
        <div className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
      )}
      
      {/* Timeline content */}
      <div className="flex-1 min-w-0">
        {renderCompactTimeline()}
      </div>
      
      {/* Edit button */}
      {canEdit && onEditClick && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={onEditClick}
        >
          <Pencil className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
