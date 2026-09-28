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
  // Fetch available techs: internal staff + affiliated independents + network
  const { data: techs = [] } = useQuery({
    queryKey: ["dispatch-techs", companyId],
    queryFn: async () => {
      const results: any[] = [];

      // Internal company staff with field_agent role
      const { data: members } = await supabase
        .from("company_members")
        .select("user_id, profiles(id, full_name, participant_type)")
        .eq("company_id", companyId!);
      (members || []).forEach((m: any) => {
        if (m.profiles) results.push({ ...m.profiles, assignment_type: "internal" });
      });

      // Affiliated independents
      const { data: affiliations } = await supabase
        .from("agent_affiliations")
        .select("profile_id, profiles(id, full_name, participant_type)")
        .eq("company_id", companyId!)
        .eq("status", "active");
      (affiliations || []).forEach((a: any) => {
        if (a.profiles && !results.find((r: any) => r.id === a.profiles.id)) {
          results.push({ ...a.profiles, assignment_type: "affiliated" });
        }
      });

      // Network independents (approved, not already affiliated)
      const existingIds = results.map((r: any) => r.id);
      const { data: network } = await supabase
        .from("profiles")
        .select("id, full_name, participant_type")
        .in("participant_type", ["independent_sales", "independent_tech"])
        .eq("network_status", "approved");
      (network || []).forEach((p: any) => {
        if (!existingIds.includes(p.id)) {
          results.push({ ...p, assignment_type: "network" });
        }
      });

      return results;
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Technician</DialogTitle>
            <DialogDescription>Select a technician to assign to this job</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
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
              onClick={() => assignJobId && assignMutation.mutate({ jobId: assignJobId, techId: selectedTechId })}
            >
              {assignMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  );
};

export default AssignTechDialog;
