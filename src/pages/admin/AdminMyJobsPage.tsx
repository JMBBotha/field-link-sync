import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useOfflineContext } from "@/contexts/OfflineContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MapPin, CalendarDays, CheckCircle, XCircle, Play, RefreshCw, CloudOff, FileText } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { JobCardListSkeleton } from "@/components/ui/skeletons";
import FieldAgentBottomNav from "@/components/FieldAgentBottomNav";
import DepositPaymentChip from "@/components/shared/DepositPaymentChip";
import { format } from "date-fns";

const STATUS_COLORS: Record<string, string> = {
  proposed: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  accepted: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  in_progress: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  completed: "bg-muted text-muted-foreground",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

type MyAssignedJobRow = {
  assignment_id: string;
  assignment_status: string | null;
  job_id: string;
  job_title: string | null;
  job_description: string | null;
  job_address: string | null;
  job_status: string | null;
  job_priority: string | null;
  job_scheduled_for: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  assignment_notes: string | null;
  created_at: string | null;
  job_type: string | null;
  deposit_invoice_id: string | null;
  deposit_invoice_status: string | null;
  deposit_invoice_paid_date: string | null;
  deposit_invoice_grand_total: number | null;
  deposit_invoice_amount_paid: number | null;
  deposit_invoice_remaining: number | null;
};

type MyJobItem = {
  id: string;
  status: string;
  notes: string | null;
  created_at: string | null;
  job_id: string;
  job_type: string | null;
  depositInvoice: {
    id: string;
    status: string | null;
    paid_date: string | null;
    grand_total: number | null;
    amount_paid: number | null;
    remaining: number | null;
  } | null;
  jobs: {
    id: string;
    title: string | null;
    description: string | null;
    address: string | null;
    scheduled_for: string | null;
    priority: string | null;
    status: string | null;
    customers: {
      name: string | null;
      phone: string | null;
    } | null;
  };
};

const AdminMyJobsPage = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { isOnline, queueOperation } = useOfflineContext();
  const { pathname } = useLocation();
  const isFieldContext = pathname.startsWith("/field");
  const [filter, setFilter] = useState<"active" | "completed">("active");

  const { data: myAssignments = [], isLoading } = useQuery<MyJobItem[]>({
    queryKey: ["my-jobs", user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return [];

      const { data, error } = await supabase.rpc("get_my_assigned_jobs", {
        p_profile_id: user.id,
      });

      if (error) throw error;

      return ((data as MyAssignedJobRow[] | null) || []).map((row) => ({
        id: row.assignment_id,
        status: row.assignment_status ?? "proposed",
        notes: row.assignment_notes,
        created_at: row.created_at,
        job_id: row.job_id,
        job_type: row.job_type,
        depositInvoice: row.deposit_invoice_id
          ? {
              id: row.deposit_invoice_id,
              status: row.deposit_invoice_status,
              paid_date: row.deposit_invoice_paid_date,
              grand_total: row.deposit_invoice_grand_total,
              amount_paid: row.deposit_invoice_amount_paid,
              remaining: row.deposit_invoice_remaining,
            }
          : null,
        jobs: {
          id: row.job_id,
          title: row.job_title,
          description: row.job_description,
          address: row.job_address,
          scheduled_for: row.job_scheduled_for,
          priority: row.job_priority,
          status: row.job_status,
          customers: row.customer_name
            ? {
                name: row.customer_name,
                phone: row.customer_phone,
              }
            : null,
        },
      }));
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ assignmentId, status, jobStatus }: { assignmentId: string; status: string; jobStatus?: string }) => {
      const updates: { status: string; started_at?: string; completed_at?: string } = { status };
      if (status === "in_progress") updates.started_at = new Date().toISOString();
      if (status === "completed") updates.completed_at = new Date().toISOString();

      const assignment = myAssignments.find((a) => a.id === assignmentId);
      const jobId = assignment?.job_id;

      // OFFLINE PATH — queue the change and let the sync worker deliver later
      if (!isOnline) {
        await queueOperation("update_job_status", "assignments", assignmentId, updates);
        if (jobStatus && jobId) {
          await queueOperation("update_job_status", "jobs", jobId, {
            status: jobStatus,
            updated_at: new Date().toISOString(),
          });
        }
        return { queued: true as const };
      }

      // ONLINE PATH
      const { error } = await supabase.from("assignments").update(updates).eq("id", assignmentId);
      if (error) throw error;

      if (jobStatus && jobId) {
        const { error: jobError } = await supabase
          .from("jobs")
          .update({ status: jobStatus, updated_at: new Date().toISOString() })
          .eq("id", jobId);
        if (jobError) throw jobError;
      }
      return { queued: false as const };
    },
    onSuccess: (result) => {
      if (result?.queued) {
        toast({
          title: "Saved offline",
          description: "Change will sync when you're back online",
        });
      } else {
        toast({ title: "Status updated" });
      }
      queryClient.invalidateQueries({ queryKey: ["my-jobs"] });
    },
    onError: (err: any) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const filtered = useMemo(
    () => myAssignments.filter((a) =>
      filter === "active" ? !["completed", "rejected"].includes(a.status) : ["completed", "rejected"].includes(a.status)
    ),
    [filter, myAssignments]
  );

  // Realtime refresh on job / assignment changes
  useEffect(() => {
    const ch = supabase
      .channel("my-jobs-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, () =>
        queryClient.invalidateQueries({ queryKey: ["my-jobs"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "assignments" }, () =>
        queryClient.invalidateQueries({ queryKey: ["my-jobs"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [queryClient]);

  return (
    <div className={`space-y-4 p-4 md:p-6 max-w-3xl mx-auto ${isFieldContext ? "pb-32" : ""}`}>
      <div className="flex items-center justify-between">
        <h1 className="page-title">My Jobs</h1>
        <Button size="sm" variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ["my-jobs"] })}>
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      <div className="flex gap-2">
        <Button
          variant={filter === "active" ? "default" : "outline"}
          className="flex-1 sm:flex-none"
          onClick={() => setFilter("active")}
        >
          Active
        </Button>
        <Button
          variant={filter === "completed" ? "default" : "outline"}
          className="flex-1 sm:flex-none"
          onClick={() => setFilter("completed")}
        >
          Completed
        </Button>
      </div>

      {isLoading ? (
        <JobCardListSkeleton rows={3} />
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 text-center py-16 text-muted-foreground">
          <CalendarDays className="h-10 w-10 opacity-40" />
          <p className="text-sm">No {filter} jobs</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((assignment) => {
            const job = assignment.jobs;
            if (!job) return null;
            return (
              <Card key={assignment.id} className="overflow-hidden">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-base leading-tight">{job.title}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[assignment.status]}`}>
                          {assignment.status.replace(/_/g, " ")}
                        </span>
                        {assignment.job_type === "installation" && assignment.depositInvoice?.id && (
                          <DepositPaymentChip
                            invoice={assignment.depositInvoice}
                            accepted
                            className="text-[10px]"
                          />
                        )}
                      </div>
                      {job.customers?.name && (
                        <div className="text-sm text-muted-foreground">{job.customers.name}</div>
                      )}
                      {job.address && (
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{job.address}</span>
                        </div>
                      )}
                      {job.scheduled_for && (
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                          {format(new Date(job.scheduled_for), "dd MMM yyyy, HH:mm")}
                        </div>
                      )}
                    </div>
                  </div>
                  {!isOnline && ["proposed", "accepted", "in_progress"].includes(assignment.status) && (
                    <div className="flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 rounded-md px-2 py-1">
                      <CloudOff className="h-3 w-3" /> Offline — actions will queue and sync when you reconnect
                    </div>
                  )}

                  {/* Full-width action buttons — mobile-friendly touch targets */}
                  {(() => {
                    const pendingVars = updateMutation.isPending
                      ? (updateMutation.variables as { assignmentId: string; status: string } | undefined)
                      : undefined;
                    const isPendingFor = (status: string) =>
                      pendingVars?.assignmentId === assignment.id && pendingVars?.status === status;
                    const anyPendingForThis = pendingVars?.assignmentId === assignment.id;
                    return (
                      <>
                        {assignment.status === "proposed" && (
                          <div className="grid grid-cols-2 gap-2">
                            <Button
                              className="h-11 gap-1.5"
                              disabled={anyPendingForThis}
                              onClick={() => updateMutation.mutate({ assignmentId: assignment.id, status: "accepted" })}
                            >
                              {isPendingFor("accepted") ? <Spinner /> : <CheckCircle className="h-4 w-4" />}
                              {isPendingFor("accepted") ? "Accepting…" : "Accept"}
                            </Button>
                            <Button
                              variant="outline"
                              className="h-11 gap-1.5"
                              disabled={anyPendingForThis}
                              onClick={() => updateMutation.mutate({ assignmentId: assignment.id, status: "rejected" })}
                            >
                              {isPendingFor("rejected") ? <Spinner /> : <XCircle className="h-4 w-4" />}
                              {isPendingFor("rejected") ? "Rejecting…" : "Reject"}
                            </Button>
                          </div>
                        )}
                        {assignment.status === "accepted" && (
                          <Button
                            className="w-full h-11 gap-1.5"
                            disabled={anyPendingForThis}
                            onClick={() => updateMutation.mutate({ assignmentId: assignment.id, status: "in_progress", jobStatus: "in_progress" })}
                          >
                            {isPendingFor("in_progress") ? <Spinner /> : <Play className="h-4 w-4" />}
                            {isPendingFor("in_progress") ? "Starting…" : "Start Job"}
                          </Button>
                        )}
                        {assignment.status === "in_progress" && (
                          <Button
                            className="w-full h-11 gap-1.5 bg-green-600 hover:bg-green-700"
                            disabled={anyPendingForThis}
                            onClick={() => updateMutation.mutate({ assignmentId: assignment.id, status: "completed", jobStatus: "completed" })}
                          >
                            {isPendingFor("completed") ? <Spinner /> : <CheckCircle className="h-4 w-4" />}
                            {isPendingFor("completed") ? "Completing…" : "Complete Job"}
                          </Button>
                        )}
                      </>
                    );
                  })()}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      {isFieldContext && <FieldAgentBottomNav />}
    </div>
  );
};

export default AdminMyJobsPage;

