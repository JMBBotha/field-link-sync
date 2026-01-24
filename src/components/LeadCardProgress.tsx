import { useState, useEffect } from "react";
import { Progress } from "@/components/ui/progress";
import { Timer } from "lucide-react";

interface LeadCardProgressProps {
  startedAt: string | null | undefined;
  estimatedDurationMinutes: number | null | undefined;
  estimatedEndTime: string | null | undefined;
  compact?: boolean;
}

const LeadCardProgress = ({
  startedAt,
  estimatedDurationMinutes,
  estimatedEndTime,
  compact = false,
}: LeadCardProgressProps) => {
  const [elapsedTime, setElapsedTime] = useState("");
  const [remainingTime, setRemainingTime] = useState("");
  const [progressPercent, setProgressPercent] = useState(0);
  const [isOvertime, setIsOvertime] = useState(false);

  useEffect(() => {
    if (!startedAt) return;

    const updateProgress = () => {
      const start = new Date(startedAt).getTime();
      const now = Date.now();
      const elapsed = now - start;

      // Format elapsed time
      const elapsedMins = Math.floor(elapsed / 60000);
      const elapsedHours = Math.floor(elapsedMins / 60);
      const elapsedMinRemainder = elapsedMins % 60;

      if (elapsedHours > 0) {
        setElapsedTime(`${elapsedHours}h ${elapsedMinRemainder}m`);
      } else {
        setElapsedTime(`${elapsedMins}m`);
      }

      // Calculate remaining and progress if we have an estimate
      if (estimatedEndTime) {
        const end = new Date(estimatedEndTime).getTime();
        const remaining = end - now;
        const totalDuration = estimatedDurationMinutes ? estimatedDurationMinutes * 60000 : end - start;

        if (remaining <= 0) {
          setIsOvertime(true);
          const overtimeMins = Math.abs(Math.floor(remaining / 60000));
          const overtimeHours = Math.floor(overtimeMins / 60);
          const overtimeMinRemainder = overtimeMins % 60;
          
          if (overtimeHours > 0) {
            setRemainingTime(`+${overtimeHours}h ${overtimeMinRemainder}m`);
          } else {
            setRemainingTime(`+${overtimeMins}m`);
          }
          setProgressPercent(100);
        } else {
          setIsOvertime(false);
          const remainingMins = Math.floor(remaining / 60000);
          const remainingHours = Math.floor(remainingMins / 60);
          const remainingMinRemainder = remainingMins % 60;
          
          if (remainingHours > 0) {
            setRemainingTime(`${remainingHours}h ${remainingMinRemainder}m`);
          } else {
            setRemainingTime(`${remainingMins}m`);
          }
          
          const progress = Math.min(100, (elapsed / totalDuration) * 100);
          setProgressPercent(progress);
        }
      } else if (estimatedDurationMinutes) {
        // No end time set, but we have duration - calculate based on that
        const totalDuration = estimatedDurationMinutes * 60000;
        const remaining = totalDuration - elapsed;
        
        if (remaining <= 0) {
          setIsOvertime(true);
          const overtimeMins = Math.abs(Math.floor(remaining / 60000));
          setRemainingTime(`+${overtimeMins}m`);
          setProgressPercent(100);
        } else {
          setIsOvertime(false);
          const remainingMins = Math.floor(remaining / 60000);
          setRemainingTime(`${remainingMins}m`);
          const progress = Math.min(100, (elapsed / totalDuration) * 100);
          setProgressPercent(progress);
        }
      } else {
        setRemainingTime("");
        setProgressPercent(0);
      }
    };

    updateProgress();
    const interval = setInterval(updateProgress, 1000);
    
    return () => clearInterval(interval);
  }, [startedAt, estimatedEndTime, estimatedDurationMinutes]);

  if (!startedAt) return null;

  const getProgressBarClass = () => {
    if (isOvertime) return "[&>div]:bg-red-500";
    if (progressPercent > 75) return "[&>div]:bg-orange-500";
    return "[&>div]:bg-green-500";
  };

  if (compact) {
    return (
      <div className="mt-2 pt-2 border-t border-border/30">
        <div className="flex items-center gap-2 mb-1">
          <Timer className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{elapsedTime}</span>
          {remainingTime && (
            <>
              <span className="text-xs text-muted-foreground">•</span>
              <span className={`text-xs font-medium ${isOvertime ? "text-red-500" : "text-primary"}`}>
                {remainingTime} {isOvertime ? "over" : "left"}
              </span>
            </>
          )}
        </div>
        {(estimatedDurationMinutes || estimatedEndTime) && (
          <Progress 
            value={progressPercent} 
            className={`h-1.5 ${getProgressBarClass()}`}
          />
        )}
      </div>
    );
  }

  return (
    <div className="mt-3 pt-3 border-t border-border/30 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-5 w-5 rounded-full bg-primary/20 flex items-center justify-center">
            <Timer className="h-3 w-3 text-primary" />
          </div>
          <span className="text-xs font-medium">{elapsedTime} elapsed</span>
        </div>
        {remainingTime && (
          <span className={`text-xs font-semibold ${isOvertime ? "text-red-500" : "text-primary"}`}>
            {remainingTime} {isOvertime ? "over" : "left"}
          </span>
        )}
      </div>
      {(estimatedDurationMinutes || estimatedEndTime) && (
        <Progress 
          value={progressPercent} 
          className={`h-2 ${getProgressBarClass()}`}
        />
      )}
    </div>
  );
};

export default LeadCardProgress;
