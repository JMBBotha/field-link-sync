import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, MapPin, Clock, User, CalendarDays, FileText } from "lucide-react";
import { format } from "date-fns";
import CreateJobDialog from "@/components/jobs/CreateJobDialog";
import RequireRole from "@/components/RequireRole";

const PRIORITY_VARIANT: Record<string, "destructive" | "default" | "secondary" | "outline"> = {
  urgent: "destructive",
  high: "destructive",
  normal: "secondary",
  low: "outline",
};

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  dispatched: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  in_progress: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  completed: "bg-muted text-muted-foreground",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

const AdminJobsPage = () => {
  const navigate = useNavigate();
  const { companyId } = useUserCompanyId();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["jobs-list", companyId, statusFilter],
    queryFn: async () => {
      let q = supabase
        .from("jobs")
        .select("*, customers(name), assignments(id, profile_id, status, profiles(full_name)), invoices!jobs_invoice_id_fkey(id, invoice_number, status)")
        .order("scheduled_for", { ascending: false, nullsFirst: false });
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: !!companyId,
  });

  const filtered = search
    ? jobs.filter((j: any) =>
        j.title.toLowerCase().includes(search.toLowerCase()) ||
        j.customers?.name?.toLowerCase().includes(search.toLowerCase()) ||
        j.address?.toLowerCase().includes(search.toLowerCase())
      )
    : jobs;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-foreground">Jobs</h1>
        <Button onClick={() => setShowCreate(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Create Job
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search jobs..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Filter status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="scheduled">Scheduled</SelectItem>
            <SelectItem value="dispatched">Dispatched</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading jobs...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          No jobs found. Create your first job to get started.
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((job: any) => {
            const assignee = job.assignments?.find((a: any) => a.status !== "rejected");
            return (
              <Card key={job.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(`/admin/jobs/${job.id}`)}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-foreground truncate">{job.title}</span>
                        <Badge variant={PRIORITY_VARIANT[job.priority] || "secondary"} className="text-[10px]">
                          {job.priority}
                        </Badge>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[job.status] || ""}`}>
                          {job.status.replace("_", " ")}
                        </span>
                      </div>
                      {job.customers?.name && (
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <User className="h-3.5 w-3.5" /> {job.customers.name}
                        </div>
                      )}
                      {job.address && (
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground truncate">
                          <MapPin className="h-3.5 w-3.5 shrink-0" /> {job.address}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0 space-y-1">
                      {job.scheduled_for && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <CalendarDays className="h-3.5 w-3.5" />
                          {format(new Date(job.scheduled_for), "dd MMM, HH:mm")}
                        </div>
                      )}
                      {assignee && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" />
                          {assignee.profiles?.full_name || "Assigned"}
                        </div>
                      )}
                      {job.invoices?.id && (
                        <button
                          onClick={(e) => { e.stopPropagation(); navigate(`/admin/invoices/${job.invoices.id}`); }}
                          className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 px-2 py-0.5 text-[10px] font-semibold hover:bg-emerald-200 dark:hover:bg-emerald-900/50 transition-colors"
                          title={`Invoice ${job.invoices.invoice_number || ""} · ${job.invoices.status || ""}`}
                        >
                          <FileText className="h-3 w-3" />
                          {job.invoices.invoice_number || "Invoice"}
                        </button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CreateJobDialog open={showCreate} onOpenChange={setShowCreate} />
    </div>
  );
};

const AdminJobsPageGuarded = () => (
  <RequireRole allowedRoles={["admin"]}>
    <AdminJobsPage />
  </RequireRole>
);

export default AdminJobsPageGuarded;
