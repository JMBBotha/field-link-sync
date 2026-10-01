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
import { MapPin, Clock, User, GripVertical, CalendarDays, Users, Loader2, Plus, Zap, Route } from "lucide-react";
import { Filter } from "lucide-react";

import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import JobActivityTimeline from "@/components/jobs/JobActivityTimeline";
import { format } from "date-fns";
import CreateJobDialog from "@/components/jobs/CreateJobDialog";
import AssignTechDialog from "@/components/jobs/AssignTechDialog";
import RowMenu from "@/components/shared/RowMenu";
import RequireRole from "@/components/RequireRole";
import { useNavigate, useSearchParams } from "react-router-dom";
import BoardChip from "@/components/jobs/BoardChip";
import { LANE_META } from "@/lib/leadLane";
import { loadEntries } from "@/lib/todaysJobs";
import CallSummary from "@/components/leads/CallSummary";
import AttentionStrip from "@/components/jobs/AttentionStrip";
import { useUndoAction } from "@/components/shared/StatusUndo";
import { buildBoardRows, groupBoardRows, rowTarget, boardLane, rowAssignee, filterBoardRows, FILTER_KEYS, type BoardRow, type BoardFilters, type Person } from "@/lib/jobsBoard";
import { AlertTriangle, Eye, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const COLUMNS = [
  { key: "scheduled", label: "Scheduled", color: "border-blue-500" },
  { key: "dispatched", label: "Dispatched", color: "border-amber-500" },
  { key: "in_progress", label: "In Progress", color: "border-green-500" },
  { key: "completed", label: "Completed", color: "border-muted-foreground" },
] as const;

const PRIORITY_VARIANT: Record<string, "destructive" | "default" | "secondary" | "outline"> = {
  urgent: "destructive", high: "destructive", normal: "secondary", low: "outline",
};

/** embedded = shown inside the Jobs hub (Dispatch · Stages): the hub supplies the title and the attention strip. */
const AdminJobsDispatchPage = ({ embedded = false }: { embedded?: boolean }) => {
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
  const [showCancelledState, setShowCancelled] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const filters: BoardFilters = Object.fromEntries(FILTER_KEYS.map((k) => [k, searchParams.get(k)]));
  const showCancelled = showCancelledState || filters.status === "cancelled";
  const setFilter = (k: (typeof FILTER_KEYS)[number], v: string | null) =>
    setSearchParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; });
  const clearFilters = () => setSearchParams((p) => { const n = new URLSearchParams(p); FILTER_KEYS.forEach((k) => n.delete(k)); return n; });
  const navigate = useNavigate();

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
  const { data: jobs = [], isLoading, isFetching, isError, error: jobsError, refetch } = useQuery({
    queryKey: ["jobs-dispatch", companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("*, customers(name, phone, address), customer_locations!jobs_location_id_fkey(label, address, latitude, longitude), assignments(id, profile_id, assignment_type, status, profiles!assignments_profile_id_fkey(full_name, participant_type))")
        .order("scheduled_for", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Booked leads / schedule rows — same source as the Today's Jobs tile (not date-limited).
  const { data: booked = { entries: [], names: {} as Record<string, Person> }, isError: bookedError, refetch: refetchBooked } = useQuery({
    queryKey: ["jobs-dispatch-booked"],
    queryFn: async () => {
      const entries = await loadEntries({});
      const ids = [...new Set(entries.map((e) => e.agent_id).filter(Boolean))] as string[];
      const names: Record<string, Person> = {};
      if (ids.length) {
        const { data } = await supabase.from("profiles").select("id, full_name, participant_type").in("id", ids);
        (data || []).forEach((p: any) => { names[p.id] = p; });
      }
      return { entries, names };
    },
  });

  // Group jobs by status
  const board = useMemo(
    () => groupBoardRows(filterBoardRows(buildBoardRows(jobs as any[], booked.entries), filters, booked.names), showCancelled),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [jobs, booked.entries, booked.names, showCancelled, searchParams.toString()],
  );
  const grouped = board.columns;

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
  const statusUndo = useUndoAction();
  const statusMutation = useMutation({
    mutationFn: async ({ jobId, status }: { jobId: string; status: string }) => {
      const prev = (jobs as any[]).find((j) => j.id === jobId);
      const { error } = await supabase.from("jobs").update({ status, updated_at: new Date().toISOString() }).eq("id", jobId);
      if (error) throw error;
      return { jobId, status, prev };
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["jobs-dispatch"] });
      if (!r?.prev || r.prev.status === r.status) return;
      const entry = statusUndo.record({ entity_type: "job", entity_id: r.jobId, field: "status", old_value: r.prev.status ?? null, new_value: r.status, label: r.prev.title || "Job", company_id: r.prev.company_id ?? null });
      toast({ title: `Moved to ${r.status.replace(/_/g, " ")}`, action: statusUndo.action(entry) });
    },
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


  const CardChips = ({ row }: { row: BoardRow }) => {
    const a = rowAssignee(row, booked.names);
    const lane = boardLane(row);
    return (
      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
        <BoardChip label={`Filter ${LANE_META[lane].label}`} className={LANE_META[lane].className} onSelect={() => setFilter("lane", lane)}>
          {LANE_META[lane].label}
        </BoardChip>
        {a ? (
          <BoardChip
            label={`Filter assignee ${a.name}`}
            className={a.contractor ? "border-warning/40 bg-warning/15 text-warning" : "border-primary/30 bg-primary/10 text-primary"}
            onSelect={() => setFilter("assignee", a.id)}
          >
            {a.contractor ? `Contractor · ${a.name}` : a.name}
          </BoardChip>
        ) : (
          <BoardChip label="Filter unassigned" className="border-border bg-muted text-muted-foreground" onSelect={() => setFilter("assignee", "none")}>
            Unassigned
          </BoardChip>
        )}
      </div>
    );
  };

  const JobCard = ({ job }: { job: any }) => {
    const assignee = job.assignments?.find((a: any) => a.status !== "rejected");
    return (
      <Card
        role="link"
        tabIndex={0}
        aria-label={`Open job ${job.title || ""}`}
        className="w-full min-w-0 cursor-pointer hover:shadow-md active:scale-[0.99] transition-all mb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        draggable
        onDragStart={e => { e.dataTransfer.setData("text/plain", job.id); setDragJobId(job.id); }}
        onDragEnd={() => setDragJobId(null)}
        onClick={() => navigate(rowTarget({ kind: "job", id: job.id }))}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(rowTarget({ kind: "job", id: job.id })); } }}
      >
        <CardContent className="p-3.5 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab shrink-0 hidden sm:block" />
              <span className="font-semibold text-[15px] leading-tight text-foreground truncate">{job.title}</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {job.status && !["scheduled","dispatched","in_progress","completed"].includes(job.status) && (
                <Badge variant="outline" className="text-[10px] capitalize">{String(job.status).replace(/_/g, " ")}</Badge>
              )}
              {job.priority && <Badge variant={PRIORITY_VARIANT[job.priority]} className="text-[10px] uppercase">{job.priority}</Badge>}
              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Quick view" onClick={e => { e.stopPropagation(); setDetailJob(job); }}>
                <Eye className="h-3.5 w-3.5" />
              </Button>
              <RowMenu label="Job actions" items={[
                { label: "Open job", onSelect: () => navigate(rowTarget({ kind: "job", id: job.id })) },
                { label: assignee ? "Reassign tech" : "Assign tech", onSelect: () => setAssignJobId(job.id) },
                ...COLUMNS.filter(c => c.key !== job.status).map((c, i) => ({ label: `Move to ${c.label}`, onSelect: () => statusMutation.mutate({ jobId: job.id, status: c.key }), separatorBefore: i === 0 })),
                { label: "Open invoice", hidden: !job.invoice_id, onSelect: () => navigate(`/admin/invoices/${job.invoice_id}`), separatorBefore: true },
                { label: "Open client", hidden: !job.customer_id, onSelect: () => navigate(`/admin/customers/${job.customer_id}`) },
              ]} />
            </div>
          </div>

          {job.customers?.name && (
            <div className="flex items-center gap-1.5 text-sm text-foreground/80">
              <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate font-medium">{job.customers.name}</span>
            </div>
          )}

          {(job.customer_locations?.address || job.address) && (
            <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                {job.customer_locations?.label && (
                  <div className="text-xs font-semibold text-foreground/90">{job.customer_locations.label}</div>
                )}
                <div className="line-clamp-2 break-words">{job.customer_locations?.address || job.address}</div>
              </div>
            </div>
          )}

          {job.scheduled_for && (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" />
              {format(new Date(job.scheduled_for), "dd MMM · HH:mm")}
            </div>
          )}

          <CardChips row={{ kind: "job", id: job.id, status: job.status ?? "", job }} />
          <div className="flex items-center justify-between pt-1 border-t border-border/40 empty:hidden">
            {assignee ? null : (
              <div className="flex gap-2 w-full">
                <Button variant="outline" size="sm" className="h-9 flex-1 text-xs" onClick={e => { e.stopPropagation(); setAssignJobId(job.id); }}>
                  <Users className="h-3.5 w-3.5 mr-1.5" /> Assign
                </Button>
                <Button variant="outline" size="sm" className="h-9 flex-1 text-xs" onClick={e => { e.stopPropagation(); autoDispatchMutation.mutate(job.id); }} disabled={autoDispatchMutation.isPending}>
                  <Zap className="h-3.5 w-3.5 mr-1.5" /> Auto
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };


  const LeadCard = ({ row }: { row: Extract<BoardRow, { kind: "lead" }> }) => {
    const e = row.entry;
    const go = () => navigate(rowTarget(row));
    return (
      <Card
        role="link"
        tabIndex={0}
        aria-label={`Open booked lead ${e.customer_name || ""}`}
        className="w-full min-w-0 cursor-pointer hover:shadow-md active:scale-[0.99] transition-all mb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={go}
        onKeyDown={ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); go(); } }}
      >
        <CardContent className="p-3.5 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <span className="min-w-0 flex-1 font-semibold text-[15px] leading-tight text-foreground truncate">{e.customer_name || "Booked lead"}</span>
            <div className="flex items-center gap-1 shrink-0">
              {e.status && !["scheduled","dispatched","in_progress","completed"].includes(e.status) && (
                <Badge variant="outline" className="text-[10px] capitalize">{e.status.replace(/_/g, " ")}</Badge>
              )}
              <Badge variant="secondary" className="text-[10px]">Lead</Badge>
              <RowMenu label="Lead actions" items={[
                { label: "Open lead", onSelect: go },
                { label: "Open client", hidden: !e.customer_id, onSelect: () => navigate(`/admin/customers/${e.customer_id}`) },
              ]} />
            </div>
          </div>
          {e.customer_address && (
            <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" /><span className="min-w-0 flex-1 line-clamp-2 break-words">{e.customer_address}</span>
            </div>
          )}
          <CallSummary lead={{ notes: e.notes, call_summary: e.call_summary }} compact />
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5 shrink-0" />
            {e.date}{e.start_time ? ` · ${e.start_time.slice(0, 5)}` : ""}
          </div>
          <CardChips row={row} />
        </CardContent>
      </Card>
    );
  };

  const retryAll = () => { refetch(); refetchBooked(); };

  return (
    <div className="space-y-4 p-3 sm:p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {embedded ? <span /> : <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">Jobs &amp; Dispatch</h1>}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground text-xs sm:text-sm">Available only</span>
            <Switch checked={showAvailableOnly} onCheckedChange={setShowAvailableOnly} />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled
                  className="gap-2 cursor-not-allowed"
                  aria-label="Optimize Route (coming soon)"
                >
                  <Route className="h-4 w-4" />
                  <span className="hidden sm:inline">Optimize Route</span>
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[220px] text-xs">
              Auto-sequence today's assignments by drive time. Coming soon.
            </TooltipContent>
          </Tooltip>
          <Button
            variant="outline"
            size="sm"
            onClick={retryAll}
            className="gap-2"
          >
            <Loader2 className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button variant="brand" onClick={() => setShowCreate(true)} className="gap-2" size="sm">
            <Plus className="h-4 w-4" /> New Job
          </Button>
        </div>
      </div>

      {!embedded && <AttentionStrip />}

      {(() => {
        const active = FILTER_KEYS.filter((k) => filters[k]);
        const label = (k: string, v: string) => {
          if (k === "assignee") return v === "none" ? "Unassigned" : `Assignee: ${booked.names[v]?.full_name || (jobs as any[]).flatMap((j) => j.assignments || []).find((x: any) => x.profile_id === v)?.profiles?.full_name || "…"}`;
          if (k === "lane") return v === "sales" ? "Sales" : "Service";
          if (k === "date") return v === "today" ? "Today" : v;
          if (k === "open") return "Open only";
          if (k === "status") return `Status: ${v.replace(/_/g, " ")}`;
          return `Type: ${v.replace(/_/g, " ")}`;
        };
        return (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">{board.visible} shown</span>
            {active.map((k) => (
              <Button key={k} variant="secondary" size="sm" className="h-8 rounded-full gap-1.5 text-xs max-w-full" onClick={() => setFilter(k, null)} aria-label={`Clear ${k} filter`}>
                <span className="truncate">{label(k, filters[k]!)}</span> <X className="h-3 w-3 shrink-0" />
              </Button>
            ))}
            {active.length > 0 && (
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearFilters}>Clear all</Button>
            )}
          </div>
        );
      })()}

      {board.cancelled > 0 && filters.status !== "cancelled" && (
        <div>
          <Button variant={showCancelled ? "secondary" : "outline"} size="sm" className="h-8 rounded-full gap-1.5 text-xs" onClick={() => setShowCancelled(v => !v)}>
            {showCancelled ? <>Showing cancelled ({board.cancelled}) <X className="h-3 w-3" /></> : <>Show cancelled ({board.cancelled})</>}
          </Button>
        </div>
      )}

      {isError || bookedError ? (
        <Card className="border-destructive/40">
          <CardContent className="p-6 flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-foreground">Couldn't load jobs</p>
              <p className="text-sm text-muted-foreground">{(jobsError as Error)?.message || "Please try again."}</p>
            </div>
            <Button variant="outline" onClick={retryAll}>Retry</Button>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {[0,1,2,3].map(i => <Skeleton key={i} className="h-[300px] rounded-xl" />)}
        </div>
      ) : board.visible === 0 ? (
        <Card><CardContent className="p-10 text-center space-y-2">
          <p className="font-semibold text-foreground">{FILTER_KEYS.some((k) => filters[k]) ? "No jobs match these filters" : "No open jobs"}</p>
          {board.cancelled > 0 && <p className="text-sm text-muted-foreground">{board.cancelled} cancelled job{board.cancelled === 1 ? "" : "s"} hidden — use the chip above to show them.</p>}
        </CardContent></Card>
      ) : (
        <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-2 md:grid md:grid-cols-2 md:gap-4 md:overflow-visible md:pb-0 xl:grid-cols-4">
          {COLUMNS.map(col => (
            <div
              key={col.key}
              className={`rounded-xl border-t-4 ${col.color} bg-card min-h-[300px] flex flex-col min-w-0 shrink-0 basis-[85%] sm:basis-[48%] snap-start md:basis-auto md:shrink`}
              onDragOver={e => e.preventDefault()}
              onDrop={e => handleDrop(e, col.key)}
            >
              <div className="p-3 flex items-center justify-between">
                <span className="font-semibold text-sm text-foreground">{col.label}</span>
                <Badge variant="outline" className="text-[10px]">{grouped[col.key]?.length || 0}</Badge>
              </div>
              <ScrollArea className="flex-1 min-w-0 px-2 pb-2 [&_[data-radix-scroll-area-viewport]>div]:!block">
                {(grouped[col.key] || []).map((row) =>
                  row.kind === "job" ? <JobCard key={`j-${row.id}`} job={row.job} /> : <LeadCard key={`l-${row.id}`} row={row} />
                )}
                {(grouped[col.key] || []).length === 0 && (
                  <div className="text-center text-xs text-muted-foreground py-8">No jobs</div>
                )}
              </ScrollArea>
            </div>
          ))}
        </div>
      )}

      <AssignTechDialog jobId={assignJobId} onClose={() => setAssignJobId(null)} availableOnly={showAvailableOnly} dayCounts={techDayCounts} />

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
                  <MapPin className="h-4 w-4 text-primary mt-0.5" />
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

const AdminJobsDispatchPageGuarded = (props: { embedded?: boolean }) => (
  <RequireRole allowedRoles={["admin", "dispatcher"]}>
    <AdminJobsDispatchPage {...props} />
  </RequireRole>
);

export default AdminJobsDispatchPageGuarded;
