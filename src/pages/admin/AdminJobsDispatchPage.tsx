import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { MapPin, Clock, User, GripVertical, CalendarDays, Users, Loader2, Plus, Zap } from "lucide-react";
import { Filter } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import JobActivityTimeline from "@/components/jobs/JobActivityTimeline";
import { format } from "date-fns";
import CreateJobDialog from "@/components/jobs/CreateJobDialog";
import RequireRole from "@/components/RequireRole";

const COLUMNS = [
  { key: "scheduled", label: "Scheduled", color: "border-blue-500" },
  { key: "dispatched", label: "Dispatched", color: "border-amber-500" },
  { key: "in_progress", label: "In Progress", color: "border-green-500" },
  { key: "completed", label: "Completed", color: "border-muted-foreground" },
] as const;

const PRIORITY_VARIANT: Record<string, "destructive" | "default" | "secondary" | "outline"> = {
  urgent: "destructive", high: "destructive", normal: "secondary", low: "outline",
};

const AdminJobsDispatchPage = () => {
  const { companyId } = useUserCompanyId();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [assignJobId, setAssignJobId] = useState<string | null>(null);
  const [selectedTechId, setSelectedTechId] = useState("");
  const [assignNotes, setAssignNotes] = useState("");
  const [detailJob, setDetailJob] = useState<any>(null);
  const [dragJobId, setDragJobId] = useState<string | null>(null);
  const [showAvailableOnly, setShowAvailableOnly] = useState(false);

  // Realtime: refresh dispatch board when jobs change
  useEffect(() => {
    const channel = supabase
      .channel("jobs-dispatch-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, () => {
        queryClient.invalidateQueries({ queryKey: ["jobs-dispatch"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);



  // Fetch jobs with assignments
  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["jobs-dispatch", companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("*, customers(name, phone, address), customer_locations!jobs_location_id_fkey(label, address, latitude, longitude), assignments(id, profile_id, assignment_type, status, profiles(full_name, participant_type))")
        .neq("status", "cancelled")
        .order("scheduled_for", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!companyId,
  });

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

  // Group jobs by status
  const grouped = useMemo(() => {
    const map: Record<string, any[]> = { scheduled: [], dispatched: [], in_progress: [], completed: [] };
    jobs.forEach((j: any) => {
      if (map[j.status]) map[j.status].push(j);
    });
    return map;
  }, [jobs]);

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
      setAssignJobId(null);
      setSelectedTechId("");
      setAssignNotes("");
    },
    onError: (err: any) => toast({ title: "Assignment failed", description: err.message, variant: "destructive" }),
  });

  // Auto-dispatch mutation (calls edge function)
  const autoDispatchMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const { data, error } = await supabase.functions.invoke("dispatch-job", {
        body: {
          job_id: jobId,
          dispatched_by: user?.id || null,
          override_assignee_id: null,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      if (data?.success) {
        toast({ title: "Auto-dispatched", description: `Assigned via ${data.assignment_type} (Tier ${data.tier_used})` });
      } else {
        toast({ title: "No available assignees", description: data?.message || "Dispatcher notified", variant: "destructive" });
      }
      queryClient.invalidateQueries({ queryKey: ["jobs-dispatch"] });
    },
    onError: (err: any) => toast({ title: "Auto-dispatch failed", description: err.message, variant: "destructive" }),
  });

  // Status update mutation (drag-drop)
  const statusMutation = useMutation({
    mutationFn: async ({ jobId, status }: { jobId: string; status: string }) => {
      const { error } = await supabase.from("jobs").update({ status, updated_at: new Date().toISOString() }).eq("id", jobId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs-dispatch"] }),
    onError: (err: any) => toast({ title: "Status update failed", description: err.message, variant: "destructive" }),
  });

  const handleDrop = (e: React.DragEvent, targetStatus: string) => {
    e.preventDefault();
    const jobId = e.dataTransfer.getData("text/plain");
    if (jobId && dragJobId) {
      statusMutation.mutate({ jobId, status: targetStatus });
    }
    setDragJobId(null);
  };

  // Today's assignment counts per tech
  const techDayCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    const today = format(new Date(), "yyyy-MM-dd");
    jobs.forEach((j: any) => {
      if (j.scheduled_for && j.scheduled_for.startsWith(today)) {
        (j.assignments || []).forEach((a: any) => {
          if (a.status !== "rejected") counts[a.profile_id] = (counts[a.profile_id] || 0) + 1;
        });
      }
    });
    return counts;
  }, [jobs]);

  // Group techs for assign modal
  const techGroups = useMemo(() => {
    const filterFn = (t: any) => !showAvailableOnly || availability[t.id];
    const internal = techs.filter((t: any) => t.assignment_type === "internal" && filterFn(t));
    const affiliated = techs.filter((t: any) => t.assignment_type === "affiliated" && filterFn(t));
    const network = techs.filter((t: any) => t.assignment_type === "network" && filterFn(t));
    return { internal, affiliated, network };
  }, [techs, showAvailableOnly, availability]);

  const JobCard = ({ job }: { job: any }) => {
    const assignee = job.assignments?.find((a: any) => a.status !== "rejected");
    return (
      <Card
        className="cursor-pointer hover:shadow-md transition-shadow mb-2"
        draggable
        onDragStart={e => { e.dataTransfer.setData("text/plain", job.id); setDragJobId(job.id); }}
        onDragEnd={() => setDragJobId(null)}
        onClick={() => setDetailJob(job)}
      >
        <CardContent className="p-3 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <GripVertical className="h-3.5 w-3.5 text-muted-foreground cursor-grab" />
              <span className="font-medium text-sm text-foreground truncate">{job.title}</span>
            </div>
            <Badge variant={PRIORITY_VARIANT[job.priority]} className="text-[9px] shrink-0">{job.priority}</Badge>
          </div>
          {job.customers?.name && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <User className="h-3 w-3" /> {job.customers.name}
            </div>
          )}
          {(job.customer_locations?.address || job.address) && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground truncate">
              <MapPin className="h-3 w-3 shrink-0" />
              {job.customer_locations?.label && (
                <span className="font-medium text-foreground">{job.customer_locations.label}:</span>
              )}
              <span className="truncate">{job.customer_locations?.address || job.address}</span>
            </div>
          )}
          {job.scheduled_for && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <CalendarDays className="h-3 w-3" /> {format(new Date(job.scheduled_for), "dd MMM HH:mm")}
            </div>
          )}
          <div className="flex items-center justify-between pt-1">
            {assignee ? (
              <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                {assignee.profiles?.full_name}
              </span>
            ) : (
              <div className="flex gap-1">
                <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={e => { e.stopPropagation(); setAssignJobId(job.id); }}>
                  <Users className="h-3 w-3 mr-1" /> Assign
                </Button>
                <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={e => { e.stopPropagation(); autoDispatchMutation.mutate(job.id); }} disabled={autoDispatchMutation.isPending}>
                  <Zap className="h-3 w-3 mr-1" /> Auto
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4 p-3 sm:p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl sm:text-2xl font-bold text-foreground">Dispatch Board</h1>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground text-xs sm:text-sm">Available only</span>
            <Switch checked={showAvailableOnly} onCheckedChange={setShowAvailableOnly} />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["jobs-dispatch"] })}
            className="gap-2"
          >
            <Loader2 className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button onClick={() => setShowCreate(true)} className="gap-2" size="sm">
            <Plus className="h-4 w-4" /> New Job
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading dispatch board...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {COLUMNS.map(col => (
            <div
              key={col.key}
              className={`rounded-xl border-t-4 ${col.color} bg-card min-h-[300px] flex flex-col`}
              onDragOver={e => e.preventDefault()}
              onDrop={e => handleDrop(e, col.key)}
            >
              <div className="p-3 flex items-center justify-between">
                <span className="font-semibold text-sm text-foreground">{col.label}</span>
                <Badge variant="outline" className="text-[10px]">{grouped[col.key]?.length || 0}</Badge>
              </div>
              <ScrollArea className="flex-1 px-2 pb-2">
                {(grouped[col.key] || []).map((job: any) => (
                  <JobCard key={job.id} job={job} />
                ))}
                {(grouped[col.key] || []).length === 0 && (
                  <div className="text-center text-xs text-muted-foreground py-8">No jobs</div>
                )}
              </ScrollArea>
            </div>
          ))}
        </div>
      )}

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

      {/* Job Detail Modal */}
      <Dialog open={!!detailJob} onOpenChange={open => { if (!open) setDetailJob(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{detailJob?.title}</DialogTitle>
            <DialogDescription>Job details and assignment history</DialogDescription>
          </DialogHeader>
          {detailJob && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Status:</span> <Badge variant="outline">{detailJob.status}</Badge></div>
                <div><span className="text-muted-foreground">Priority:</span> <Badge variant={PRIORITY_VARIANT[detailJob.priority]}>{detailJob.priority}</Badge></div>
                {detailJob.customers?.name && <div><span className="text-muted-foreground">Customer:</span> {detailJob.customers.name}</div>}
                {detailJob.scheduled_for && <div><span className="text-muted-foreground">Scheduled:</span> {format(new Date(detailJob.scheduled_for), "dd MMM yyyy HH:mm")}</div>}
              </div>
              {(detailJob.customer_locations?.address || detailJob.address) && (
                <div className="text-sm flex items-start gap-1">
                  <MapPin className="h-4 w-4 text-[#0066CC] mt-0.5" />
                  <div>
                    {detailJob.customer_locations?.label && (
                      <span className="font-semibold">{detailJob.customer_locations.label}</span>
                    )}
                    <span className="text-muted-foreground"> — {detailJob.customer_locations?.address || detailJob.address}</span>
                  </div>
                </div>
              )}
              {detailJob.description && (
                <div className="text-sm"><span className="text-muted-foreground">Description:</span> {detailJob.description}</div>
              )}
              <Separator />
              <div>
                <h4 className="font-semibold text-sm mb-2">Assignments</h4>
                {detailJob.assignments?.length > 0 ? (
                  <div className="space-y-2">
                    {detailJob.assignments.map((a: any) => (
                      <div key={a.id} className="flex items-center justify-between bg-muted/50 rounded-lg p-2 text-sm">
                        <div>
                          <span className="font-medium">{a.profiles?.full_name}</span>
                          <span className="text-xs text-muted-foreground ml-2">({a.assignment_type})</span>
                        </div>
                        <Badge variant="outline" className="text-[10px]">{a.status}</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No assignments yet</p>
                )}
              </div>
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={() => { setDetailJob(null); setAssignJobId(detailJob.id); }}>
                  <Users className="h-4 w-4 mr-1" /> Assign Tech
                </Button>
              </div>
              <Separator />
              <JobActivityTimeline jobId={detailJob.id} />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <CreateJobDialog open={showCreate} onOpenChange={setShowCreate} />
    </div>
  );
};

const AdminJobsDispatchPageGuarded = () => (
  <RequireRole allowedRoles={["admin"]}>
    <AdminJobsDispatchPage />
  </RequireRole>
);

export default AdminJobsDispatchPageGuarded;
