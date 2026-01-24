import { useState, useEffect } from "react";
import { Timer, Clock, Plus, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import JobDurationPicker from "./JobDurationPicker";

interface JobProgressSectionProps {
  startedAt: string;
  estimatedDurationMinutes: number | null;
  estimatedEndTime: string | null;
  onExtendTime: (additionalMinutes: number) => Promise<void>;
  onAdjustTime: (newTotalMinutes: number) => Promise<void>;
}

const JobProgressSection = ({
  startedAt,
  estimatedDurationMinutes,
  estimatedEndTime,
  onExtendTime,
  onAdjustTime,
}: JobProgressSectionProps) => {
  const [elapsedTime, setElapsedTime] = useState("");
  const [remainingTime, setRemainingTime] = useState("");
  const [progressPercent, setProgressPercent] = useState(0);
  const [isOvertime, setIsOvertime] = useState(false);
  const [showAdjustPicker, setShowAdjustPicker] = useState(false);
  const [showExtendPicker, setShowExtendPicker] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  // Update timer every second for smoother progress
  useEffect(() => {
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
            setRemainingTime(`+${overtimeHours}h ${overtimeMinRemainder}m over`);
          } else {
            setRemainingTime(`+${overtimeMins}m over`);
          }
          setProgressPercent(100);
        } else {
          setIsOvertime(false);
          const remainingMins = Math.floor(remaining / 60000);
          const remainingHours = Math.floor(remainingMins / 60);
          const remainingMinRemainder = remainingMins % 60;
          
          if (remainingHours > 0) {
            setRemainingTime(`${remainingHours}h ${remainingMinRemainder}m left`);
          } else {
            setRemainingTime(`${remainingMins}m left`);
          }
          
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

  const handleExtend = async (additionalMinutes: number) => {
    setIsUpdating(true);
    try {
      await onExtendTime(additionalMinutes);
      setShowExtendPicker(false);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleAdjust = async (newTotalMinutes: number) => {
    setIsUpdating(true);
    try {
      await onAdjustTime(newTotalMinutes);
      setShowAdjustPicker(false);
    } finally {
      setIsUpdating(false);
    }
  };

  const getProgressColor = () => {
    if (isOvertime) return "bg-red-500";
    if (progressPercent > 75) return "bg-orange-500";
    return "bg-green-500";
  };

  return (
    <>
      <div className="space-y-3 p-4 rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center">
              <Timer className="h-4 w-4 text-primary" />
            </div>
            <span className="font-semibold text-sm">Job Progress</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setShowAdjustPicker(true)}
          >
            <Settings2 className="h-3 w-3 mr-1" />
            Adjust
          </Button>
        </div>

        {/* Time Display */}
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-foreground">{elapsedTime}</p>
            <p className="text-xs text-muted-foreground">Elapsed</p>
          </div>
          <div className="text-center">
            <p className={`text-2xl font-bold ${isOvertime ? "text-red-500" : "text-primary"}`}>
              {remainingTime || "--"}
            </p>
            <p className="text-xs text-muted-foreground">
              {isOvertime ? "Overtime" : "Remaining"}
            </p>
          </div>
        </div>

        {/* Progress Bar */}
        {estimatedDurationMinutes && (
          <div className="space-y-1">
            <Progress 
              value={progressPercent} 
              className={`h-2 ${isOvertime ? "[&>div]:bg-red-500" : progressPercent > 75 ? "[&>div]:bg-orange-500" : ""}`}
            />
            <p className="text-xs text-center text-muted-foreground">
              {Math.round(progressPercent)}% complete
            </p>
          </div>
        )}

        {/* Quick Extend Buttons */}
        <div className="flex gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-8 text-xs"
            onClick={() => handleExtend(30)}
            disabled={isUpdating}
          >
            <Plus className="h-3 w-3 mr-1" />
            30 min
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-8 text-xs"
            onClick={() => handleExtend(60)}
            disabled={isUpdating}
          >
            <Plus className="h-3 w-3 mr-1" />
            1 hr
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs px-3"
            onClick={() => setShowExtendPicker(true)}
            disabled={isUpdating}
          >
            <Clock className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Adjust Time Picker */}
      <JobDurationPicker
        open={showAdjustPicker}
        onClose={() => setShowAdjustPicker(false)}
        onConfirm={handleAdjust}
        isLoading={isUpdating}
        mode="adjust"
        currentDuration={estimatedDurationMinutes || 60}
      />

      {/* Extend Time Picker */}
      <JobDurationPicker
        open={showExtendPicker}
        onClose={() => setShowExtendPicker(false)}
        onConfirm={(minutes) => handleExtend(minutes - (estimatedDurationMinutes || 0))}
        isLoading={isUpdating}
        mode="extend"
        currentDuration={estimatedDurationMinutes || 60}
      />
    </>
  );
};

export default JobProgressSection;
