import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, User } from "lucide-react";
import { mapDispatchCandidates } from "@/lib/teamGroups";
import { useClashGuard } from "@/components/scheduling/ClashGuard";
import { fromMinutes, jobMinutes, sastParts, toMinutes } from "@/lib/schedulingDefaults";
import AvailabilityPicker from "@/components/scheduling/AvailabilityPicker";

/**
 * The Jobs board's Assign Technician dialog (moved here unchanged so the
 * job detail page can reuse it). Inserts an assignment and moves a
 * scheduled job to dispatched.
 */
const AssignTechDialog = ({ jobId, onClose, availableOnly = false, dayCounts = {} }: {
  jobId: string | null; onClose: () => void; availableOnly?: boolean; dayCounts?: Record<string, number>;
}) => {
  const { companyId } = useUserCompanyId();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedTechId, setSelectedTechId] = useState("");
  const [assignNotes, setAssignNotes] = useState("");
  const assignJobId = jobId;
  const showAvailableOnly = availableOnly;
  const techDayCounts = dayCounts;
  const setAssignJobId = (_: null) => onClose();
  const { confirmBooking, dialog: clashDialog } = useClashGuard();

  /** Clash check over the job's scheduled_for + estimated_duration (SAST). */
  const checkClash = async (jobId: string, techId: string) => {
    const { data: job } = await supabase.from("jobs").select("scheduled_for, estimated_duration, job_type").eq("id", jobId).maybeSingle();
    if (!(job as any)?.scheduled_for) return true;
    const { date, time } = sastParts((job as any).scheduled_for);
    return confirmBooking({
      profileId: techId, date, start: time, end: fromMinutes(toMinutes(time) + jobMinutes(job as any)),
      excludeJobId: jobId, entity: { type: "job", id: jobId },
    });
  };
  // S5: the job's slot + location for the ranked picker (read-only).
  const { data: jobSlot } = useQuery({
    queryKey: ["assign-tech-job-slot", jobId],
    enabled: !!jobId,
    queryFn: async () => {
      const { data } = await supabase.from("jobs").select("scheduled_for, estimated_duration, job_type, lat, lng").eq("id", jobId!).maybeSingle();
      const j = data as any;
      if (!j?.scheduled_for) return null;
      const { date, time } = sastParts(j.scheduled_for);
      return { date, time, minutes: jobMinutes(j), lat: j.lat != null ? Number(j.lat) : null, lng: j.lng != null ? Number(j.lng) : null };
    },
  });
  // Fetch available techs: internal staff + affiliated independents + network
  const { data: techs = [] } = useQuery({
    queryKey: ["dispatch-techs", companyId],
    queryFn: async () => {
      // Only the people who may be offered a job (company + connected freelance technicians)
      const { data, error } = await supabase.rpc("dispatchable_technicians" as any, { _company_id: companyId! });
      if (error) throw error;
      return mapDispatchCandidates(data as any) as any[];
    },
    enabled: !!companyId,
  });

  // Fetch availability for all techs
  const { data: availability = {} } = useQuery({
    queryKey: ["dispatch-availability", techs.map((t: any) => t.id).join(",")],
    queryFn: async () => {
      if (techs.length === 0) return {};
      const ids = techs.map((t: any) => t.id);
      const now = new Date();
      const dow = now.getDay();
      const currentTime = now.toTimeString().slice(0, 8);

      const { data } = await supabase
        .from("agent_availability")
        .select("agent_id, is_available, start_time, end_time")
        .in("agent_id", ids)
        .eq("day_of_week", dow);

      const result: Record<string, boolean> = {};
      ids.forEach((id: string) => { result[id] = false; });
      (data || []).forEach((row: any) => {
        result[row.agent_id] = row.is_available && row.start_time <= currentTime && row.end_time >= currentTime;
      });
      return result;
    },
    enabled: techs.length > 0,
    refetchInterval: 60000,
  });

  // Assign tech mutation
  const assignMutation = useMutation({
    mutationFn: async ({ jobId, techId }: { jobId: string; techId: string }) => {
      const tech = techs.find((t: any) => t.id === techId);
      const { error } = await supabase.from("assignments").insert({
        job_id: jobId,
        profile_id: techId,
        assigned_by: user?.id || null,
        assignment_type: tech?.assignment_type || "internal",
        notes: assignNotes || null,
      });
      if (error) throw error;
      // Move job to dispatched if still scheduled
      await supabase.from("jobs").update({ status: "dispatched", updated_at: new Date().toISOString() }).eq("id", jobId).eq("status", "scheduled");
    },
    onSuccess: () => {
      toast({ title: "Technician assigned" });
      queryClient.invalidateQueries({ queryKey: ["jobs-dispatch"] });
      queryClient.invalidateQueries({ queryKey: ["job-detail"] });
      setAssignJobId(null);
      setSelectedTechId("");
      setAssignNotes("");
    },
    onError: (err: any) => toast({ title: "Assignment failed", description: err.message, variant: "destructive" }),
  });

  // Group techs for assign modal
  const techGroups = useMemo(() => {
    const filterFn = (t: any) => !showAvailableOnly || availability[t.id];
    const internal = techs.filter((t: any) => t.assignment_type === "internal" && filterFn(t));
    const affiliated = techs.filter((t: any) => t.assignment_type === "affiliated" && filterFn(t));
    const network = techs.filter((t: any) => t.assignment_type === "network" && filterFn(t));
    return { internal, affiliated, network };
  }, [techs, showAvailableOnly, availability]);
  return (
    <>
      {/* Assign Tech Modal */}
      <Dialog open={!!assignJobId} onOpenChange={open => { if (!open) setAssignJobId(null); }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Assign Technician</DialogTitle>
            <DialogDescription>Select a technician to assign to this job</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {jobSlot && assignJobId && (
              <AvailabilityPicker lane="service" date={jobSlot.date} startTime={jobSlot.time} minutes={jobSlot.minutes}
                lat={jobSlot.lat} lng={jobSlot.lng} excludeJobId={assignJobId} selectedId={selectedTechId}
                onSelect={(id) => setSelectedTechId(id)} />
            )}
            {[
              { label: "Internal Staff", items: techGroups.internal },
              { label: "Affiliated Independents", items: techGroups.affiliated },
              { label: "Network Independents", items: techGroups.network },
            ].map(group => group.items.length > 0 && (
              <div key={group.label}>
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">{group.label}</Label>
                <div className="space-y-1 mt-1">
                  {group.items.map((tech: any) => (
                    <button
                      key={tech.id}
                      onClick={() => setSelectedTechId(tech.id)}
                      className={`w-full flex items-center justify-between p-2 rounded-lg text-sm transition-colors ${
                        selectedTechId === tech.id ? "bg-primary/10 border border-primary" : "hover:bg-muted"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${availability[tech.id] ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span className="text-foreground">{tech.full_name}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{techDayCounts[tech.id] || 0} today</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div>
              <Label>Notes (optional)</Label>
              <Textarea value={assignNotes} onChange={e => setAssignNotes(e.target.value)} placeholder="Assignment notes..." rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignJobId(null)}>Cancel</Button>
            <Button
              disabled={!selectedTechId || assignMutation.isPending}
              onClick={async () => {
                if (!assignJobId) return;
                if (!(await checkClash(assignJobId, selectedTechId))) return;
                assignMutation.mutate({ jobId: assignJobId, techId: selectedTechId });
              }}
            >
              {assignMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {clashDialog}
    </>
  );
};

export default AssignTechDialog;
