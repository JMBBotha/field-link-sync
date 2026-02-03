import { useState } from "react";
import { format } from "date-fns";
import { Calendar, Clock, Loader2, Check } from "lucide-react";
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
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface Lead {
  id: string;
  scheduled_date?: string | null;
  started_at?: string | null;
  actual_start_time?: string | null;
  completed_at?: string | null;
  estimated_duration_minutes?: number | null;
}

interface LeadTimeEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead;
  onSaved: () => void;
}

const LeadTimeEditDialog = ({
  open,
  onOpenChange,
  lead,
  onSaved,
}: LeadTimeEditDialogProps) => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  // Form state
  const [scheduledDate, setScheduledDate] = useState<Date | undefined>(
    lead.scheduled_date ? new Date(lead.scheduled_date) : undefined
  );
  const [startTime, setStartTime] = useState<string>(
    lead.actual_start_time 
      ? format(new Date(lead.actual_start_time), "HH:mm")
      : lead.started_at 
        ? format(new Date(lead.started_at), "HH:mm")
        : ""
  );
  const [startDate, setStartDate] = useState<Date | undefined>(
    lead.actual_start_time 
      ? new Date(lead.actual_start_time)
      : lead.started_at 
        ? new Date(lead.started_at)
        : undefined
  );
  const [completedTime, setCompletedTime] = useState<string>(
    lead.completed_at ? format(new Date(lead.completed_at), "HH:mm") : ""
  );
  const [completedDate, setCompletedDate] = useState<Date | undefined>(
    lead.completed_at ? new Date(lead.completed_at) : undefined
  );
  const [duration, setDuration] = useState<string>(
    lead.estimated_duration_minutes?.toString() || ""
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {};

      // Scheduled date
      if (scheduledDate) {
        updates.scheduled_date = format(scheduledDate, "yyyy-MM-dd");
      }

      // Start time - combine date and time
      if (startDate && startTime) {
        const [hours, minutes] = startTime.split(":").map(Number);
        const combined = new Date(startDate);
        combined.setHours(hours, minutes, 0, 0);
        updates.actual_start_time = combined.toISOString();
        updates.started_at = combined.toISOString();
      }

      // Completed time - combine date and time
      if (completedDate && completedTime) {
        const [hours, minutes] = completedTime.split(":").map(Number);
        const combined = new Date(completedDate);
        combined.setHours(hours, minutes, 0, 0);
        updates.completed_at = combined.toISOString();
      }

      // Duration
      if (duration) {
        const mins = parseInt(duration, 10);
        if (!isNaN(mins) && mins > 0) {
          updates.estimated_duration_minutes = mins;
          
          // Recalculate estimated_end_time if we have start time
          if (updates.actual_start_time) {
            const start = new Date(updates.actual_start_time as string);
            const end = new Date(start.getTime() + mins * 60 * 1000);
            updates.estimated_end_time = end.toISOString();
          }
        }
      }

      if (Object.keys(updates).length === 0) {
        toast({ title: "No changes", description: "Nothing to update" });
        onOpenChange(false);
        return;
      }

      const { error } = await supabase
        .from("leads")
        .update(updates)
        .eq("id", lead.id);

      if (error) throw error;

      toast({
        title: "Updated ✓",
        description: "Lead times have been updated",
      });

      onSaved();
      onOpenChange(false);
    } catch (error: unknown) {
      console.error("Error updating lead times:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Edit Lead Times
          </DialogTitle>
          <DialogDescription>
            Update scheduled date, start time, completion time, and duration.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-4 py-4">
            {/* Scheduled Date */}
            <div className="space-y-2">
              <Label>Scheduled Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !scheduledDate && "text-muted-foreground"
                    )}
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    {scheduledDate ? format(scheduledDate, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={scheduledDate}
                    onSelect={setScheduledDate}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Start Date & Time */}
            <div className="space-y-2">
              <Label>Start Date & Time</Label>
              <div className="flex gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "flex-1 justify-start text-left font-normal",
                        !startDate && "text-muted-foreground"
                      )}
                    >
                      <Calendar className="mr-2 h-4 w-4" />
                      {startDate ? format(startDate, "MMM d") : "Date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent
                      mode="single"
                      selected={startDate}
                      onSelect={setStartDate}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <Input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-28"
                />
              </div>
            </div>

            {/* Completed Date & Time */}
            <div className="space-y-2">
              <Label>Completed Date & Time</Label>
              <div className="flex gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "flex-1 justify-start text-left font-normal",
                        !completedDate && "text-muted-foreground"
                      )}
                    >
                      <Calendar className="mr-2 h-4 w-4" />
                      {completedDate ? format(completedDate, "MMM d") : "Date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent
                      mode="single"
                      selected={completedDate}
                      onSelect={setCompletedDate}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <Input
                  type="time"
                  value={completedTime}
                  onChange={(e) => setCompletedTime(e.target.value)}
                  className="w-28"
                />
              </div>
            </div>

            {/* Duration */}
            <div className="space-y-2">
              <Label>Estimated Duration (minutes)</Label>
              <Input
                type="number"
                placeholder="60"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                min="1"
              />
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="shrink-0 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Check className="h-4 w-4 mr-2" />
                Save Changes
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default LeadTimeEditDialog;
