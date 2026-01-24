import { useState } from "react";
import { Clock, Plus, Minus, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface JobDurationPickerProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (durationMinutes: number) => void;
  isLoading?: boolean;
  mode?: "start" | "adjust" | "extend";
  currentDuration?: number; // For adjust mode
}

const QUICK_PICKS = [
  { label: "30 min", value: 30 },
  { label: "1 hr", value: 60 },
  { label: "1.5 hr", value: 90 },
  { label: "2 hr", value: 120 },
  { label: "3 hr", value: 180 },
  { label: "4+ hr", value: 240 },
];

const EXTEND_OPTIONS = [
  { label: "+30 min", value: 30 },
  { label: "+1 hr", value: 60 },
  { label: "+1.5 hr", value: 90 },
  { label: "+2 hr", value: 120 },
];

const JobDurationPicker = ({
  open,
  onClose,
  onConfirm,
  isLoading = false,
  mode = "start",
  currentDuration = 0,
}: JobDurationPickerProps) => {
  const [selectedMinutes, setSelectedMinutes] = useState<number | null>(null);
  const [customHours, setCustomHours] = useState(1);
  const [customMinutes, setCustomMinutes] = useState(0);
  const [useCustom, setUseCustom] = useState(false);

  const handleQuickPick = (minutes: number) => {
    setSelectedMinutes(minutes);
    setUseCustom(false);
  };

  const handleCustomChange = () => {
    setUseCustom(true);
    setSelectedMinutes(null);
  };

  const handleConfirm = () => {
    let duration: number;
    if (useCustom) {
      duration = customHours * 60 + customMinutes;
    } else if (selectedMinutes !== null) {
      duration = selectedMinutes;
    } else {
      return; // No selection
    }
    
    if (mode === "extend") {
      duration = currentDuration + duration;
    }
    
    onConfirm(duration);
  };

  const getTotalMinutes = () => {
    if (useCustom) {
      return customHours * 60 + customMinutes;
    }
    return selectedMinutes || 0;
  };

  const formatDuration = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  };

  const isValid = useCustom ? (customHours > 0 || customMinutes > 0) : selectedMinutes !== null;

  const getTitle = () => {
    switch (mode) {
      case "adjust": return "Adjust Time Estimate";
      case "extend": return "Extend Job Time";
      default: return "Estimated Job Duration";
    }
  };

  const getDescription = () => {
    switch (mode) {
      case "adjust": return "Update your estimated completion time";
      case "extend": return `Current estimate: ${formatDuration(currentDuration)}. Add extra time:`;
      default: return "How long do you expect this job to take?";
    }
  };

  const pickOptions = mode === "extend" ? EXTEND_OPTIONS : QUICK_PICKS;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Timer className="h-5 w-5 text-primary" />
            {getTitle()}
          </DialogTitle>
          <DialogDescription>
            {getDescription()}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Quick Pick Buttons */}
          <div className="grid grid-cols-3 gap-2">
            {pickOptions.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant={selectedMinutes === option.value && !useCustom ? "default" : "outline"}
                className={`h-12 ${selectedMinutes === option.value && !useCustom ? "ring-2 ring-primary ring-offset-2" : ""}`}
                onClick={() => handleQuickPick(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>

          {/* Custom Duration Option */}
          {mode !== "extend" && (
            <>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">or custom</span>
                </div>
              </div>

              <div 
                className={`p-4 rounded-lg border-2 transition-colors cursor-pointer ${
                  useCustom ? "border-primary bg-primary/5" : "border-muted hover:border-muted-foreground/50"
                }`}
                onClick={handleCustomChange}
              >
                <Label className="text-sm font-medium mb-3 block">Custom Duration</Label>
                <div className="flex items-center justify-center gap-4">
                  {/* Hours */}
                  <div className="flex flex-col items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCustomHours(Math.min(12, customHours + 1));
                        setUseCustom(true);
                        setSelectedMinutes(null);
                      }}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                    <div className="text-2xl font-bold w-12 text-center">{customHours}</div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCustomHours(Math.max(0, customHours - 1));
                        setUseCustom(true);
                        setSelectedMinutes(null);
                      }}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <span className="text-xs text-muted-foreground">hours</span>
                  </div>

                  <span className="text-2xl font-bold">:</span>

                  {/* Minutes */}
                  <div className="flex flex-col items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCustomMinutes((prev) => (prev + 15) % 60);
                        setUseCustom(true);
                        setSelectedMinutes(null);
                      }}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                    <div className="text-2xl font-bold w-12 text-center">{customMinutes.toString().padStart(2, '0')}</div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCustomMinutes((prev) => (prev - 15 + 60) % 60);
                        setUseCustom(true);
                        setSelectedMinutes(null);
                      }}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <span className="text-xs text-muted-foreground">minutes</span>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Preview */}
          {isValid && (
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <p className="text-sm text-muted-foreground">
                {mode === "extend" ? "New total estimate:" : "Estimated duration:"}
              </p>
              <p className="text-lg font-semibold text-primary">
                {mode === "extend" 
                  ? formatDuration(currentDuration + getTotalMinutes())
                  : formatDuration(getTotalMinutes())
                }
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button 
            type="button" 
            onClick={handleConfirm}
            disabled={!isValid || isLoading}
          >
            {isLoading ? (
              <>
                <Clock className="h-4 w-4 mr-2 animate-spin" />
                {mode === "start" ? "Starting..." : "Updating..."}
              </>
            ) : (
              mode === "start" ? "Start Job" : "Confirm"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default JobDurationPicker;
