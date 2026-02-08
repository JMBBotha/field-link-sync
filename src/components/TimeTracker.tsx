import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, Clock, Car, Save, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface TimeTrackerProps {
  leadId: string;
  agentId: string;
  onSaved?: () => void;
}

const TimeTracker = ({ leadId, agentId, onSaved }: TimeTrackerProps) => {
  const [workDate, setWorkDate] = useState<Date>(new Date());
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("17:00");
  const [travelHours, setTravelHours] = useState("0");
  const [isBillable, setIsBillable] = useState(true);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const calculateHours = () => {
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    const diff = (eh * 60 + em - (sh * 60 + sm)) / 60;
    return Math.max(0, Math.round(diff * 100) / 100);
  };

  const handleSave = async () => {
    if (!startTime || !endTime) {
      toast({ title: "Error", description: "Start and end time are required", variant: "destructive" });
      return;
    }

    const hours = calculateHours();
    if (hours <= 0) {
      toast({ title: "Error", description: "End time must be after start time", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from("job_time_entries").insert({
        lead_id: leadId,
        agent_id: agentId,
        work_date: format(workDate, "yyyy-MM-dd"),
        start_time: startTime + ":00",
        end_time: endTime + ":00",
        travel_hours: parseFloat(travelHours) || 0,
        is_billable: isBillable,
        notes: notes || null,
      });

      if (error) throw error;

      toast({ title: "Time entry saved ⏱️", description: `${hours}h on-site logged` });
      setNotes("");
      onSaved?.();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const hoursOnSite = calculateHours();
  const totalHours = hoursOnSite + (parseFloat(travelHours) || 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Clock className="h-4 w-4 text-primary" />
        Log Time Entry
      </div>

      {/* Date Picker */}
      <div className="space-y-1.5">
        <Label className="text-xs">Work Date</Label>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn("w-full justify-start text-left font-normal text-sm", !workDate && "text-muted-foreground")}>
              <CalendarIcon className="mr-2 h-4 w-4" />
              {workDate ? format(workDate, "EEE, dd MMM yyyy") : "Pick a date"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={workDate} onSelect={(d) => d && setWorkDate(d)} initialFocus className="p-3 pointer-events-auto" />
          </PopoverContent>
        </Popover>
      </div>

      {/* Time Inputs */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Start Time</Label>
          <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">End Time</Label>
          <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="text-sm" />
        </div>
      </div>

      {/* Travel Hours */}
      <div className="space-y-1.5">
        <Label className="text-xs flex items-center gap-1.5">
          <Car className="h-3.5 w-3.5" /> Travel Hours
        </Label>
        <Input
          type="number"
          min="0"
          step="0.25"
          value={travelHours}
          onChange={(e) => setTravelHours(e.target.value)}
          className="text-sm"
          placeholder="0"
        />
      </div>

      {/* Billable Toggle */}
      <div className="flex items-center justify-between py-1">
        <Label className="text-xs">Billable</Label>
        <Switch checked={isBillable} onCheckedChange={setIsBillable} />
      </div>

      {/* Notes */}
      <div className="space-y-1.5">
        <Label className="text-xs">Work Description</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Describe work done..."
          className="text-sm min-h-[60px]"
        />
      </div>

      {/* Summary Card */}
      <div className="rounded-lg bg-muted/50 p-3 text-xs space-y-1">
        <div className="flex justify-between"><span className="text-muted-foreground">On-site:</span><span className="font-medium">{hoursOnSite.toFixed(2)}h</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Travel:</span><span className="font-medium">{(parseFloat(travelHours) || 0).toFixed(2)}h</span></div>
        <div className="flex justify-between border-t pt-1 mt-1"><span className="font-semibold">Total:</span><span className="font-bold">{totalHours.toFixed(2)}h</span></div>
        {isBillable && (
          <div className="flex justify-between text-primary">
            <span>Est. Amount (R450/h):</span>
            <span className="font-bold">R{(totalHours * 450).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</span>
          </div>
        )}
      </div>

      <Button onClick={handleSave} disabled={saving} className="w-full">
        {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
        Save Time Entry
      </Button>
    </div>
  );
};

export default TimeTracker;
