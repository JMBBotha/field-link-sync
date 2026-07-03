import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MapPin, CalendarDays, CheckCircle, XCircle, Play, RefreshCw } from "lucide-react";
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
};

type MyJobItem = {
  id: string;
  status: string;
  notes: string | null;
  created_at: string | null;
  job_id: string;
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

      const { error } = await supabase.from("assignments").update(updates).eq("id", assignmentId);
      if (error) throw error;

      // Also update job status if needed
      if (jobStatus) {
        const assignment = myAssignments.find((a) => a.id === assignmentId);
        if (assignment?.job_id) {
          const { error: jobError } = await supabase.from("jobs").update({ status: jobStatus, updated_at: new Date().toISOString() }).eq("id", assignment.job_id);
          if (jobError) throw jobError;
        }
      }
    },
    onSuccess: () => {
      toast({ title: "Status updated" });
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

  return (
    <div className="space-y-4 p-4 md:p-6">
      <h1 className="text-2xl font-bold text-foreground">My Jobs</h1>

      <div className="flex gap-2">
        <Button variant={filter === "active" ? "default" : "outline"} size="sm" onClick={() => setFilter("active")}>Active</Button>
        <Button variant={filter === "completed" ? "default" : "outline"} size="sm" onClick={() => setFilter("completed")}>Completed</Button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No {filter} jobs</div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((assignment) => {
            const job = assignment.jobs;
            if (!job) return null;
            return (
              <Card key={assignment.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-foreground">{job.title}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[assignment.status]}`}>
                          {assignment.status}
                        </span>
                      </div>
                      {job.customers?.name && (
                        <div className="text-sm text-muted-foreground">{job.customers.name}</div>
                      )}
                      {job.address && (
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5" /> {job.address}
                        </div>
                      )}
                      {job.scheduled_for && (
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <CalendarDays className="h-3.5 w-3.5" />
                          {format(new Date(job.scheduled_for), "dd MMM yyyy, HH:mm")}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {assignment.status === "proposed" && (
                        <>
                          <Button size="sm" className="gap-1 h-7 text-xs" onClick={() => updateMutation.mutate({ assignmentId: assignment.id, status: "accepted" })}>
                            <CheckCircle className="h-3 w-3" /> Accept
                          </Button>
                          <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={() => updateMutation.mutate({ assignmentId: assignment.id, status: "rejected" })}>
                            <XCircle className="h-3 w-3" /> Reject
                          </Button>
                        </>
                      )}
                      {assignment.status === "accepted" && (
                        <Button size="sm" className="gap-1 h-7 text-xs" onClick={() => updateMutation.mutate({ assignmentId: assignment.id, status: "in_progress", jobStatus: "in_progress" })}>
                          <Play className="h-3 w-3" /> Start
                        </Button>
                      )}
                      {assignment.status === "in_progress" && (
                        <Button size="sm" className="gap-1 h-7 text-xs" onClick={() => updateMutation.mutate({ assignmentId: assignment.id, status: "completed", jobStatus: "completed" })}>
                          <CheckCircle className="h-3 w-3" /> Complete
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdminMyJobsPage;
