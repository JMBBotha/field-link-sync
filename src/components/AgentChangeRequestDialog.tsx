import { useState } from "react";
import { format } from "date-fns";
import { Clock, Calendar, Timer, CheckCircle2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface Lead {
  id: string;
  scheduled_date?: string | null;
  started_at?: string | null;
  actual_start_time?: string | null;
  completed_at?: string | null;
  estimated_duration_minutes?: number | null;
}

type RequestType = "adjust_start_time" | "adjust_scheduled_date" | "adjust_completed_time" | "adjust_duration";

interface PresetOption {
  type: RequestType;
  label: string;
  icon: React.ReactNode;
  description: string;
}

const PRESET_OPTIONS: PresetOption[] = [
  {
    type: "adjust_start_time",
    label: "Adjust Start Time",
    icon: <Clock className="h-5 w-5" />,
    description: "Change when the job actually started",
  },
  {
    type: "adjust_scheduled_date",
    label: "Adjust Scheduled Date",
    icon: <Calendar className="h-5 w-5" />,
    description: "Change the scheduled date for the job",
  },
  {
    type: "adjust_completed_time",
    label: "Adjust Completion Time",
    icon: <CheckCircle2 className="h-5 w-5" />,
    description: "Change when the job was completed",
  },
  {
    type: "adjust_duration",
    label: "Adjust Duration",
    icon: <Timer className="h-5 w-5" />,
    description: "Change the estimated job duration",
  },
];

interface AgentChangeRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead;
  agentId: string;
  onRequestSent: () => void;
}

const AgentChangeRequestDialog = ({
  open,
  onOpenChange,
  lead,
  agentId,
  onRequestSent,
}: AgentChangeRequestDialogProps) => {
  const { toast } = useToast();
  const [step, setStep] = useState<"select" | "details">("select");
  const [selectedType, setSelectedType] = useState<RequestType | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form values for each type
  const [newDate, setNewDate] = useState<Date | undefined>();
  const [newTime, setNewTime] = useState<string>("");
  const [newDuration, setNewDuration] = useState<string>("");
  const [reason, setReason] = useState<string>("");

  const resetForm = () => {
    setStep("select");
    setSelectedType(null);
    setNewDate(undefined);
    setNewTime("");
    setNewDuration("");
    setReason("");
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  const handleSelectType = (type: RequestType) => {
    setSelectedType(type);
    
    // Pre-fill with current values
    if (type === "adjust_start_time" && lead.actual_start_time) {
      const d = new Date(lead.actual_start_time);
      setNewDate(d);
      setNewTime(format(d, "HH:mm"));
    } else if (type === "adjust_scheduled_date" && lead.scheduled_date) {
      setNewDate(new Date(lead.scheduled_date));
    } else if (type === "adjust_completed_time" && lead.completed_at) {
      const d = new Date(lead.completed_at);
      setNewDate(d);
      setNewTime(format(d, "HH:mm"));
    } else if (type === "adjust_duration" && lead.estimated_duration_minutes) {
      setNewDuration(lead.estimated_duration_minutes.toString());
    }
    
    setStep("details");
  };

  const getCurrentValue = (): string => {
    if (!selectedType) return "";
    
    switch (selectedType) {
      case "adjust_start_time":
        return lead.actual_start_time 
          ? format(new Date(lead.actual_start_time), "PPp")
          : "Not set";
      case "adjust_scheduled_date":
        return lead.scheduled_date 
          ? format(new Date(lead.scheduled_date), "PP")
          : "Not set";
      case "adjust_completed_time":
        return lead.completed_at 
          ? format(new Date(lead.completed_at), "PPp")
          : "Not set";
      case "adjust_duration":
        return lead.estimated_duration_minutes 
          ? `${lead.estimated_duration_minutes} minutes`
          : "Not set";
      default:
        return "";
    }
  };

  const getRequestedValue = (): string => {
    if (!selectedType) return "";
    
    switch (selectedType) {
      case "adjust_start_time":
      case "adjust_completed_time":
        if (newDate && newTime) {
          const [hours, minutes] = newTime.split(":").map(Number);
          const combined = new Date(newDate);
          combined.setHours(hours, minutes, 0, 0);
          return combined.toISOString();
        }
        return "";
      case "adjust_scheduled_date":
        return newDate ? format(newDate, "yyyy-MM-dd") : "";
      case "adjust_duration":
        return newDuration ? `${newDuration} minutes` : "";
      default:
        return "";
    }
  };

  const handleSubmit = async () => {
    if (!selectedType) return;
    
    const requestedValue = getRequestedValue();
    if (!requestedValue) {
      toast({
        title: "Missing value",
        description: "Please enter the new value",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.from("lead_change_requests").insert({
        lead_id: lead.id,
        requested_by: agentId,
        request_type: selectedType,
        current_value: getCurrentValue(),
        requested_value: requestedValue,
        reason: reason || null,
        status: "pending",
      });

      if (error) throw error;

      toast({
        title: "Request Sent ✓",
        description: "Your change request has been submitted for admin approval",
      });

      onRequestSent();
      handleClose();
    } catch (error: unknown) {
      console.error("Error submitting change request:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to submit request",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Request Time Change
          </DialogTitle>
          <DialogDescription>
            {step === "select" 
              ? "Select what you'd like to change"
              : "Enter the new value and reason for the change"
            }
          </DialogDescription>
        </DialogHeader>

        {step === "select" ? (
          <div className="grid gap-2 py-4">
            {PRESET_OPTIONS.map((option) => (
              <button
                key={option.type}
                onClick={() => handleSelectType(option.type)}
                className="flex items-center gap-3 p-3 rounded-lg border hover:bg-accent transition-colors text-left"
              >
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                  {option.icon}
                </div>
                <div>
                  <p className="font-medium">{option.label}</p>
                  <p className="text-xs text-muted-foreground">{option.description}</p>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-4 py-4">
            {/* Current Value */}
            <div className="p-3 rounded-lg bg-muted/50">
              <p className="text-xs text-muted-foreground">Current Value</p>
              <p className="font-medium">{getCurrentValue()}</p>
            </div>

            {/* New Value Input */}
            {(selectedType === "adjust_start_time" || selectedType === "adjust_completed_time") && (
              <div className="space-y-2">
                <Label>New Date & Time</Label>
                <div className="flex gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "flex-1 justify-start text-left font-normal",
                          !newDate && "text-muted-foreground"
                        )}
                      >
                        <Calendar className="mr-2 h-4 w-4" />
                        {newDate ? format(newDate, "MMM d") : "Date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarComponent
                        mode="single"
                        selected={newDate}
                        onSelect={setNewDate}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <Input
                    type="time"
                    value={newTime}
                    onChange={(e) => setNewTime(e.target.value)}
                    className="w-28"
                  />
                </div>
              </div>
            )}

            {selectedType === "adjust_scheduled_date" && (
              <div className="space-y-2">
                <Label>New Scheduled Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !newDate && "text-muted-foreground"
                      )}
                    >
                      <Calendar className="mr-2 h-4 w-4" />
                      {newDate ? format(newDate, "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent
                      mode="single"
                      selected={newDate}
                      onSelect={setNewDate}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            )}

            {selectedType === "adjust_duration" && (
              <div className="space-y-2">
                <Label>New Duration (minutes)</Label>
                <Input
                  type="number"
                  placeholder="60"
                  value={newDuration}
                  onChange={(e) => setNewDuration(e.target.value)}
                  min="1"
                />
              </div>
            )}

            {/* Reason */}
            <div className="space-y-2">
              <Label>Reason (optional)</Label>
              <Textarea
                placeholder="Why do you need this change?"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {step === "details" && (
            <Button variant="outline" onClick={() => setStep("select")}>
              Back
            </Button>
          )}
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          {step === "details" && (
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                "Submit Request"
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AgentChangeRequestDialog;
