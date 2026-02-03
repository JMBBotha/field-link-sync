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

  // Simple date & time state
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(() => {
    if (lead.scheduled_date) return new Date(lead.scheduled_date);
    if (lead.actual_start_time) return new Date(lead.actual_start_time);
    return new Date();
  });
  const [selectedTime, setSelectedTime] = useState<string>(() => {
    if (lead.actual_start_time) return format(new Date(lead.actual_start_time), "HH:mm");
    return format(new Date(), "HH:mm");
  });
  const [reason, setReason] = useState<string>("");

  const handleClose = () => {
    setReason("");
    onOpenChange(false);
  };

  const getCurrentValue = (): string => {
    if (lead.scheduled_date && lead.actual_start_time) {
      return format(new Date(lead.actual_start_time), "PPp");
    }
    if (lead.scheduled_date) {
      return format(new Date(lead.scheduled_date), "PP");
    }
    return "Not set";
  };

  const handleSubmit = async () => {
    if (!selectedDate) {
      toast({
        title: "Missing date",
        description: "Please select a date",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      // Combine date and time
      const [hours, minutes] = selectedTime.split(":").map(Number);
      const combined = new Date(selectedDate);
      combined.setHours(hours, minutes, 0, 0);
      
      const requestedValue = combined.toISOString();

      const { error } = await supabase.from("lead_change_requests").insert({
        lead_id: lead.id,
        requested_by: agentId,
        request_type: "adjust_scheduled_date",
        current_value: getCurrentValue(),
        requested_value: requestedValue,
        reason: reason || null,
        status: "pending",
      });

      if (error) throw error;

      toast({
        title: "Request Sent ✓",
        description: "Your time change request has been submitted",
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
            Request Time Change
          </DialogTitle>
          <DialogDescription>
            Select a new date and time for this job
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Current Value */}
          <div className="p-2.5 rounded-lg bg-muted/50 text-sm">
            <span className="text-muted-foreground">Current: </span>
            <span className="font-medium">{getCurrentValue()}</span>
          </div>

          {/* Date Picker */}
          <div className="space-y-1.5">
            <Label className="text-sm">New Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !selectedDate && "text-muted-foreground"
                  )}
                >
                  <Calendar className="mr-2 h-4 w-4" />
                  {selectedDate ? format(selectedDate, "EEE, MMM d, yyyy") : "Pick a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <CalendarComponent
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  initialFocus
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Time Picker */}
          <div className="space-y-1.5">
            <Label className="text-sm">New Time</Label>
            <Input
              type="time"
              value={selectedTime}
              onChange={(e) => setSelectedTime(e.target.value)}
              className="w-full"
            />
          </div>

          {/* Reason */}
          <div className="space-y-1.5">
            <Label className="text-sm">Reason (optional)</Label>
            <Textarea
              placeholder="Brief reason for the change..."
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
