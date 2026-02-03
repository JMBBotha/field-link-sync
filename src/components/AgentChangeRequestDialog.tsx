import { useState } from "react";
import { format } from "date-fns";
import { Clock, Calendar, Loader2 } from "lucide-react";
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
  const [submitting, setSubmitting] = useState(false);

  // Helper to format time consistently
  const formatDateTime = (dateStr: string) => format(new Date(dateStr), "MMM d, h:mm a");

  // Job date
  const [jobDate, setJobDate] = useState<Date | undefined>(() => {
    if (lead.completed_at) return new Date(lead.completed_at);
    if (lead.actual_start_time) return new Date(lead.actual_start_time);
    if (lead.scheduled_date) return new Date(lead.scheduled_date);
    return new Date();
  });

  // Start and end times
  const [startTime, setStartTime] = useState<string>(() => {
    if (lead.actual_start_time) return format(new Date(lead.actual_start_time), "HH:mm");
    return "09:00";
  });
  
  const [endTime, setEndTime] = useState<string>(() => {
    if (lead.completed_at) return format(new Date(lead.completed_at), "HH:mm");
    return "10:00";
  });

  const [reason, setReason] = useState<string>("");

  const handleClose = () => {
    setReason("");
    onOpenChange(false);
  };

  const getCurrentValues = (): string => {
    const parts: string[] = [];
    if (lead.actual_start_time) {
      parts.push(`Started: ${format(new Date(lead.actual_start_time), "MMM d, h:mm a")}`);
    }
    if (lead.completed_at) {
      parts.push(`Completed: ${format(new Date(lead.completed_at), "MMM d, h:mm a")}`);
    }
    if (parts.length === 0) {
      return "No times recorded";
    }
    return parts.join(" • ");
  };

  const handleSubmit = async () => {
    if (!jobDate) {
      toast({
        title: "Missing date",
        description: "Please select a job date",
        variant: "destructive",
      });
      return;
    }

    if (!startTime || !endTime) {
      toast({
        title: "Missing times",
        description: "Please enter both start and end times",
        variant: "destructive",
      });
      return;
    }

    // Validate end time is after start time
    if (startTime >= endTime) {
      toast({
        title: "Invalid times",
        description: "End time must be after start time",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      // Combine date with times
      const [startHours, startMins] = startTime.split(":").map(Number);
      const [endHours, endMins] = endTime.split(":").map(Number);
      
      const startDateTime = new Date(jobDate);
      startDateTime.setHours(startHours, startMins, 0, 0);
      
      const endDateTime = new Date(jobDate);
      endDateTime.setHours(endHours, endMins, 0, 0);

      // Calculate duration in minutes
      const durationMinutes = Math.round((endDateTime.getTime() - startDateTime.getTime()) / 60000);

      // Format duration for display
      const hours = Math.floor(durationMinutes / 60);
      const mins = durationMinutes % 60;
      let durationStr = "";
      if (hours > 0 && mins > 0) durationStr = `${hours}h ${mins}m`;
      else if (hours > 0) durationStr = `${hours}h`;
      else durationStr = `${mins}m`;

      // Format requested value in same style as current value display
      const requestedValue = `${format(jobDate, "MMM d")}: ${format(startDateTime, "h:mm a")} → ${format(endDateTime, "h:mm a")} (${durationStr})`;

      // Store ISO values in reason field as JSON for approval processing
      const requestData = JSON.stringify({
        startTime: startDateTime.toISOString(),
        endTime: endDateTime.toISOString(),
      });

      const { error } = await supabase.from("lead_change_requests").insert({
        lead_id: lead.id,
        requested_by: agentId,
        request_type: "adjust_job_times",
        current_value: getCurrentValues(),
        requested_value: requestedValue,
        reason: reason ? `${reason}\n---\n${requestData}` : requestData,
        status: "pending",
      });

      if (error) throw error;

      toast({
        title: "Request Sent ✓",
        description: "Your time change request has been submitted for admin approval",
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
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Adjust Job Time
          </DialogTitle>
          <DialogDescription>
            Request changes to job start/end times (requires admin approval)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Current Values */}
          <div className="p-2.5 rounded-lg bg-muted/50 text-xs">
            <span className="text-muted-foreground">Current: </span>
            <span className="font-medium">{getCurrentValues()}</span>
          </div>

          {/* Job Date */}
          <div className="space-y-1.5">
            <Label className="text-sm">Job Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !jobDate && "text-muted-foreground"
                  )}
                >
                  <Calendar className="mr-2 h-4 w-4" />
                  {jobDate ? format(jobDate, "EEE, MMM d, yyyy") : "Pick a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <CalendarComponent
                  mode="single"
                  selected={jobDate}
                  onSelect={setJobDate}
                  initialFocus
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Start & End Times in a row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm">Start Time</Label>
              <Input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">End Time</Label>
              <Input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full"
              />
            </div>
          </div>

          {/* Duration Preview */}
          {startTime && endTime && startTime < endTime && (
            <div className="text-center text-sm text-muted-foreground">
              Duration: {(() => {
                const [sh, sm] = startTime.split(":").map(Number);
                const [eh, em] = endTime.split(":").map(Number);
                const mins = (eh * 60 + em) - (sh * 60 + sm);
                const hours = Math.floor(mins / 60);
                const remainingMins = mins % 60;
                if (hours > 0 && remainingMins > 0) return `${hours}h ${remainingMins}m`;
                if (hours > 0) return `${hours}h`;
                return `${remainingMins}m`;
              })()}
            </div>
          )}

          {/* Reason */}
          <div className="space-y-1.5">
            <Label className="text-sm">Reason (optional)</Label>
            <Textarea
              placeholder="Why do you need to adjust these times?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleClose} size="sm">
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting} size="sm">
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Sending...
              </>
            ) : (
              "Submit Request"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AgentChangeRequestDialog;
