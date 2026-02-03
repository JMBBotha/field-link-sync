import { format } from "date-fns";
import { Calendar, Clock, ArrowRight, Pencil } from "lucide-react";
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

  return (
    <div className="p-3 rounded-xl bg-background/50 space-y-3">
      {/* Header with edit button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">Schedule</span>
        </div>
        {canEdit && onEditClick && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs px-2 text-primary"
            onClick={onEditClick}
          >
            <Pencil className="h-3 w-3 mr-1" />
            Edit
          </Button>
        )}
      </div>

      {/* Timeline visualization */}
      <div className="space-y-2">
        {/* Scheduled date (for pending/claimed jobs) */}
        {scheduledDate && isPending && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
            <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
              <Calendar className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-muted-foreground">Scheduled</p>
              <p className="text-sm font-medium">
                {format(new Date(scheduledDate), "EEE, MMM d, yyyy")}
              </p>
            </div>
          </div>
        )}

        {/* Time range display (for in-progress and completed jobs) */}
        {(isInProgress || isCompleted) && effectiveStartTime && (
          <div className="flex items-stretch gap-2">
            {/* Start time */}
            <div className="flex-1 p-2 rounded-lg bg-muted/50">
              <div className="flex items-center gap-1.5 mb-1">
                <div className={cn(
                  "h-2 w-2 rounded-full",
                  isCompleted ? "bg-green-500" : "bg-primary"
                )} />
                <p className="text-[10px] text-muted-foreground">Started</p>
              </div>
              <p className="text-sm font-medium">
                {format(new Date(effectiveStartTime), "h:mm a")}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {format(new Date(effectiveStartTime), "MMM d")}
              </p>
            </div>

            {/* Arrow */}
            <div className="flex items-center justify-center px-1">
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </div>

            {/* End time */}
            <div className="flex-1 p-2 rounded-lg bg-muted/50">
              <div className="flex items-center gap-1.5 mb-1">
                <div className={cn(
                  "h-2 w-2 rounded-full",
                  isCompleted ? "bg-green-500" : "bg-orange-400"
                )} />
                <p className="text-[10px] text-muted-foreground">
                  {isCompleted ? "Completed" : "Est. End"}
                </p>
              </div>
              {effectiveEndTime ? (
                <>
                  <p className="text-sm font-medium">
                    {format(new Date(effectiveEndTime), "h:mm a")}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {format(new Date(effectiveEndTime), "MMM d")}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">--:--</p>
              )}
            </div>
          </div>
        )}

        {/* Duration badge */}
        {estimatedDurationMinutes && (
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              Duration: <span className="font-medium text-foreground">{formatDuration(estimatedDurationMinutes)}</span>
            </span>
            {isCompleted && effectiveStartTime && completedAt && (
              <span className="text-[10px] text-green-600 font-medium ml-auto">
                ✓ Completed
              </span>
            )}
          </div>
        )}

        {/* For completed jobs without start time, show just completion */}
        {isCompleted && !effectiveStartTime && completedAt && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-green-500/10">
            <div className="h-8 w-8 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
              <Clock className="h-4 w-4 text-green-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-muted-foreground">Completed</p>
              <p className="text-sm font-medium">
                {format(new Date(completedAt), "EEE, MMM d 'at' h:mm a")}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
