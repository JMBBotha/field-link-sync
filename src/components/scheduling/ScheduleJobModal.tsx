import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Trash2 } from "lucide-react";
import { useClashGuard } from "./ClashGuard";
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

const computeEndTime = (start: string, durationMinutes: number) => {
  if (!start) return "";
  const parsed = parse(start, "HH:mm", new Date());
  return format(addMinutes(parsed, durationMinutes), "HH:mm");
};

const minutesBetween = (start: string, end: string) => {
  if (!start || !end) return 120;
  const s = parse(start, "HH:mm", new Date());
  const e = parse(end, "HH:mm", new Date());
  return Math.max(15, Math.round((e.getTime() - s.getTime()) / 60000));
};

const ScheduleJobModal = ({
  open, onOpenChange, selectedDate, selectedStart, selectedEnd,
  existingEvent, existingSchedules, onSaved,
}: ScheduleJobModalProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [leadId, setLeadId] = useState("");
  const [appt, setAppt] = useState<AppointmentValue>({
    date: "",
    startTime: "08:00",
    durationMinutes: 120,
    agentId: "",
  });
  const [notes, setNotes] = useState("");
  const { confirmBooking, dialog: clashDialog } = useClashGuard();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existingEvent) {
      setLeadId(existingEvent.leadId);
      setNotes(existingEvent.notes || "");
    } else {
      setLeadId("");
      setNotes("");
    }
    setAppt((prev) => ({
      date: selectedDate ? selectedDate.toISOString().split("T")[0] : prev.date,
      startTime: selectedStart
        ? `${String(selectedStart.getHours()).padStart(2, "0")}:${String(selectedStart.getMinutes()).padStart(2, "0")}`
        : prev.startTime || "08:00",
      durationMinutes: selectedStart && selectedEnd
        ? Math.max(15, Math.round((selectedEnd.getTime() - selectedStart.getTime()) / 60000))
        : prev.durationMinutes || 120,
      agentId: existingEvent?.agentId ?? prev.agentId,
    }));
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

  // Site coordinates for distance ranking: lead first, then its customer
  const { data: leadLoc } = useQuery({
    queryKey: ["schedule-lead-location", leadId],
    enabled: open && !!leadId,
    queryFn: async () => {
      const { data } = await supabase.from("leads").select("latitude, longitude, customer_id").eq("id", leadId).maybeSingle();
      const ok = (v: any) => v != null && Number(v) !== 0;
      if (data && ok(data.latitude) && ok(data.longitude)) return { lat: Number(data.latitude), lng: Number(data.longitude) };
      if (data?.customer_id) {
        const { data: c } = await supabase.from("customers").select("latitude, longitude").eq("id", data.customer_id).maybeSingle();
        if (c && ok(c.latitude) && ok(c.longitude)) return { lat: Number(c.latitude), lng: Number(c.longitude) };
      }
      return null;
    },
  });

  const handleSave = async () => {
    const { agentId, date, startTime, durationMinutes } = appt;
    if (!leadId || !agentId || !date || !startTime) {
      toast({ title: "Please fill all required fields", variant: "destructive" });
      return;
    }
    const ev: any = existingEvent;
    const ok = await confirmBooking({
      profileId: agentId, date, start: startTime, end: computeEndTime(startTime, durationMinutes),
      excludeJobId: ev?.job_id ?? null, excludeLeadId: ev?.job_id ? null : leadId,
      entity: ev?.job_id ? { type: "job", id: ev.job_id } : { type: "lead", id: leadId },
    });
    if (!ok) return;
    setSaving(true);
    try {
      const endTime = computeEndTime(startTime, durationMinutes);
      const payload = {
        lead_id: leadId,
        agent_id: agentId,
        scheduled_date: date,
        start_time: startTime,
        end_time: endTime,
        notes: notes || null,
      };
      if (existingEvent) {
        const { error } = await supabase.from("job_schedules").update(payload).eq("id", existingEvent.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("job_schedules").insert(payload);
        if (error) throw error;
      }
      // Install rows (job_id) must not overwrite the sales lead's own visit/person
      if (!(existingEvent as any)?.job_id) {
        const { error: leadErr } = await supabase.from("leads").update({
          scheduled_date: date,
          scheduled_time: startTime,
          assigned_agent_id: agentId,
        }).eq("id", leadId);
        if (leadErr) throw leadErr;
      }

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
      const ev: any = existingEvent;
      if (!ev.job_id && ev.lead_id) {
        // Clear the lead's booking too, or Dispatch re-creates the tile from the lead (the DB trigger removes the row)
        const { data: cleared, error: clrErr } = await supabase.from("leads")
          .update({ scheduled_date: null, scheduled_time: null }).eq("id", ev.lead_id).select("id");
        if (clrErr) throw clrErr;
        if (!cleared?.length) throw new Error("Not removed: no permission to change this lead.");
      }
      const { error } = await supabase.from("job_schedules").delete().eq("id", ev.id);
      if (error) throw error;
      const { data: still } = await supabase.from("job_schedules").select("id").eq("id", ev.id);
      if (still?.length) throw new Error("Not removed: no permission to delete this slot.");
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
    <>
    {clashDialog}
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
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

          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <AppointmentPicker value={appt} onChange={setAppt} lat={leadLoc?.lat ?? null} lng={leadLoc?.lng ?? null} excludeLeadId={leadId || null} />
          </div>

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
    </>
  );
};

export default ScheduleJobModal;
