import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import AppointmentPicker, { type AppointmentValue } from "./AppointmentPicker";
import { format, parse, addMinutes } from "date-fns";

interface ScheduleJobModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedDate?: Date;
  selectedStart?: Date;
  selectedEnd?: Date;
  existingEvent?: { id: string; leadId: string; agentId: string; notes?: string };
  existingSchedules: any[];
  onSaved: () => void;
}

const ScheduleJobModal = ({
  open, onOpenChange, selectedDate, selectedStart, selectedEnd,
  existingEvent, existingSchedules, onSaved,
}: ScheduleJobModalProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [leadId, setLeadId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("10:00");
  const [notes, setNotes] = useState("");
  const [conflict, setConflict] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existingEvent) {
      setLeadId(existingEvent.leadId);
      setAgentId(existingEvent.agentId);
      setNotes(existingEvent.notes || "");
    } else {
      setLeadId("");
      setAgentId("");
      setNotes("");
    }
    if (selectedDate) {
      setDate(selectedDate.toISOString().split("T")[0]);
    }
    if (selectedStart) {
      setStartTime(`${String(selectedStart.getHours()).padStart(2, "0")}:${String(selectedStart.getMinutes()).padStart(2, "0")}`);
    }
    if (selectedEnd) {
      setEndTime(`${String(selectedEnd.getHours()).padStart(2, "0")}:${String(selectedEnd.getMinutes()).padStart(2, "0")}`);
    }
    setConflict(null);
  }, [open, existingEvent, selectedDate, selectedStart, selectedEnd]);

  // Fetch unscheduled leads
  const { data: leads = [] } = useQuery({
    queryKey: ["schedulable-leads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("id, customer_name, service_type, status")
        .in("status", ["pending", "accepted"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  // Fetch agents
  const { data: agents = [] } = useQuery({
    queryKey: ["schedule-agents"],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "field_agent");
      if (!roles?.length) return [];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", roles.map((r: any) => r.user_id));
      return profiles || [];
    },
    enabled: open,
  });

  // Check conflicts
  useEffect(() => {
    if (!agentId || !date || !startTime || !endTime) {
      setConflict(null);
      return;
    }
    const conflicting = existingSchedules.find((s: any) => {
      if (existingEvent && s.id === existingEvent.id) return false;
      if (s.agent_id !== agentId || s.scheduled_date !== date) return false;
      return startTime < s.end_time && endTime > s.start_time;
    });
    setConflict(conflicting ? `Conflicts with ${conflicting.leads?.customer_name || "another job"} (${conflicting.start_time}–${conflicting.end_time})` : null);
  }, [agentId, date, startTime, endTime, existingSchedules, existingEvent]);

  const handleSave = async () => {
    if (!leadId || !agentId || !date || !startTime || !endTime) {
      toast({ title: "Please fill all required fields", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = { lead_id: leadId, agent_id: agentId, scheduled_date: date, start_time: startTime, end_time: endTime, notes: notes || null };
      if (existingEvent) {
        const { error } = await supabase.from("job_schedules").update(payload).eq("id", existingEvent.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("job_schedules").insert(payload);
        if (error) throw error;
      }
      // Also update lead scheduled_date
      await supabase.from("leads").update({ scheduled_date: date, scheduled_time: startTime, assigned_agent_id: agentId }).eq("id", leadId);

      toast({ title: existingEvent ? "Schedule updated" : "Job scheduled" });
      queryClient.invalidateQueries({ queryKey: ["job-schedules"] });
      onSaved();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!existingEvent) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("job_schedules").delete().eq("id", existingEvent.id);
      if (error) throw error;
      toast({ title: "Schedule removed" });
      queryClient.invalidateQueries({ queryKey: ["job-schedules"] });
      onSaved();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{existingEvent ? "Edit Schedule" : "Schedule Job"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Job</Label>
            <Select value={leadId} onValueChange={setLeadId}>
              <SelectTrigger><SelectValue placeholder="Select job..." /></SelectTrigger>
              <SelectContent>
                {leads.map((l: any) => (
                  <SelectItem key={l.id} value={l.id}>{l.customer_name} — {l.service_type}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Agent</Label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger><SelectValue placeholder="Select agent..." /></SelectTrigger>
              <SelectContent>
                {agents.map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>{a.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Start Time</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div>
              <Label>End Time</Label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>

          {conflict && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{conflict}</AlertDescription>
            </Alert>
          )}

          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional notes..." />
          </div>
        </div>

        <DialogFooter className="flex gap-2">
          {existingEvent && (
            <Button variant="destructive" onClick={handleDelete} disabled={saving}>
              <Trash2 className="h-4 w-4 mr-1" /> Delete
            </Button>
          )}
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {existingEvent ? "Update" : "Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ScheduleJobModal;
