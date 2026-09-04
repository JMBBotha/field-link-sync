import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { jobTypeLabel } from "@/lib/jobTypes";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  MapPin,
  CalendarDays,
  User,
  FileText,
  Clock,
  Loader2,
  Image as ImageIcon,
  Play,
  CheckCircle2,
  Phone,
  Navigation,
} from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";
import RequireRole from "@/components/RequireRole";
import JobActivityTimeline from "@/components/jobs/JobActivityTimeline";
import { PhotoGallery } from "@/components/PhotoGallery";
import { useOfflineContext } from "@/contexts/OfflineContext";
import { useToast } from "@/hooks/use-toast";
import { JobDetailSkeleton } from "@/components/ui/skeletons";
import EntityDetailsForm from "@/components/entity/EntityDetailsForm";
import DepositPaymentChip from "@/components/shared/DepositPaymentChip";
import { attachPaymentTotals } from "@/lib/depositInvoice";

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  dispatched: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  in_progress: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  completed: "bg-muted text-muted-foreground",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

const PRIORITY_VARIANT: Record<string, "destructive" | "default" | "secondary" | "outline"> = {
  urgent: "destructive",
  high: "destructive",
  normal: "secondary",
  low: "outline",
};

const AdminJobDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isOnline } = useOfflineContext();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);

  const { data: job, isLoading } = useQuery({
    queryKey: ["job-detail", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select(
          "*, customers(id, name, phone), customer_locations!jobs_location_id_fkey(id, label, address_line1, city), invoices!jobs_invoice_id_fkey(id, invoice_number, status, grand_total)"
        )
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const rawInvoice: any = (job as any)?.invoices ?? null;
  const { data: depositInvoice } = useQuery({
    queryKey: ["job-detail-invoice-payments", rawInvoice?.id],
    enabled: !!rawInvoice?.id,
    queryFn: async () => (await attachPaymentTotals([{ ...rawInvoice }]))[0],
  });

  // Quote / build path: light summary when the job carries quote_id
  const quoteId: string | null = (job as any)?.quote_id ?? null;
  const { data: quoteSummary } = useQuery({
    queryKey: ["job-quote-summary", quoteId],
    enabled: !!quoteId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_quote_summary", { p_quote_id: quoteId! });
      if (error) throw error;
      return ((data as any[])?.[0] ?? null) as
        | { id: string; quote_number: string; status: string; total: number | null; customer_name: string | null }
        | null;
    },
  });

  const changeStatus = async (nextStatus: "in_progress" | "completed") => {
    if (!id || !job) return;
    setPendingStatus(nextStatus);

    const detailKey = ["job-detail", id];
    const prevDetail = qc.getQueryData<any>(detailKey);
    const prevLists = qc.getQueriesData<any[]>({ queryKey: ["jobs"] });

    // Optimistic patch
    qc.setQueryData(detailKey, (prev: any) =>
      prev ? { ...prev, status: nextStatus } : prev,
    );
    prevLists.forEach(([k, list]) => {
      if (!Array.isArray(list)) return;
      qc.setQueryData(
        k,
        list.map((j: any) => (j.id === id ? { ...j, status: nextStatus } : j)),
      );
    });

    try {
      const patch: any = { status: nextStatus };
      if (nextStatus === "in_progress") patch.started_at = new Date().toISOString();
      if (nextStatus === "completed") patch.completed_at = new Date().toISOString();
      const { error } = await supabase.from("jobs").update(patch).eq("id", id);
      if (error) throw error;
      toast({ title: nextStatus === "in_progress" ? "Job started" : "Job completed" });
      qc.invalidateQueries({ queryKey: detailKey });
      qc.invalidateQueries({ queryKey: ["jobs"] });
    } catch (err: any) {
      // Rollback
      if (prevDetail) qc.setQueryData(detailKey, prevDetail);
      prevLists.forEach(([k, v]) => qc.setQueryData(k, v));
      toast({
        title: "Couldn't update job",
        description: err.message || "Reverted.",
        variant: "destructive",
      });
    } finally {
      setPendingStatus(null);
    }
  };

  if (isLoading) {
    return <JobDetailSkeleton />;
  }

  if (!job) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin/jobs")} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Back to Jobs
        </Button>
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Job not found or you don't have access.
          </CardContent>
        </Card>
      </div>
    );
  }

  const j: any = job;
  const location = j.customer_locations;
  const invoice = depositInvoice ?? j.invoices;

  return (
    <div className="pb-28 md:pb-24">
      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4 has-sticky-action-bar">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin/jobs")} className="gap-1.5 -ml-2">
            <ArrowLeft className="h-4 w-4" /> Jobs
          </Button>
        </div>

        {/* Job info */}
        <Card>
          <CardContent className="p-4 md:p-5 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <h1 className="text-xl md:text-2xl font-bold leading-tight">{j.title}</h1>
                <div className="flex items-center gap-2 flex-wrap mt-1.5">
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                      STATUS_COLORS[j.status] || "bg-muted text-muted-foreground"
                    }`}
                  >
                    {(j.status || "unknown").replace(/_/g, " ")}
                  </span>
                  {j.priority && (
                    <Badge variant={PRIORITY_VARIANT[j.priority] || "secondary"} className="text-[10px]">
                      {j.priority}
                    </Badge>
                  )}
                  {j.job_type && (
                    <Badge variant="outline" className="text-[10px]">
                      {jobTypeLabel(j.job_type)}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            <EntityDetailsForm
              entityType="job"
              entityId={j.id}
              initialData={j}
              visibleFields={[
                "title",
                "status",
                "priority",
                "job_type",
                "scheduled_for",
                "estimated_duration",
                "address",
                "description",
              ]}
            />

            <div className="grid gap-2 text-sm">
              {j.customers?.name && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <User className="h-4 w-4 shrink-0" />
                  <button
                    onClick={() => navigate(`/admin/customers/${j.customers.id}`)}
                    className="text-foreground hover:underline text-left"
                  >
                    {j.customers.name}
                  </button>
                  {j.customers.phone && <span className="text-xs">· {j.customers.phone}</span>}
                </div>
              )}
              {(location?.label || location?.address_line1) && (
                <div className="flex items-start gap-2 text-muted-foreground">
                  <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
                  <span className="text-foreground">
                    {location?.label ? <strong>{location.label}</strong> : null}
                    {location?.address_line1 && (
                      <>
                        {location?.label ? " · " : ""}
                        {location.address_line1}
                        {location.city ? `, ${location.city}` : ""}
                      </>
                    )}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>




        {/* Linked invoice */}
        {invoice?.id && (
          <Card>
            <CardContent className="p-4 md:p-5 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                  Linked Invoice
                </div>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="font-semibold">{invoice.invoice_number || "Invoice"}</span>
                  <DepositPaymentChip invoice={invoice} className="text-[10px]" />
                  {typeof invoice.grand_total === "number" && (
                    <span className="text-sm text-muted-foreground">
                      R {invoice.grand_total.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                    </span>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => navigate(`/admin/invoices/${invoice.id}`)}
              >
                <FileText className="h-4 w-4" /> View Invoice
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Photos (only when the job originated from a lead) */}
        {j.lead_id && (
          <Card>
            <CardContent className="p-4 md:p-5 space-y-3">
              <h3 className="font-semibold text-sm flex items-center gap-1.5">
                <ImageIcon className="h-4 w-4 text-muted-foreground" /> Photos
              </h3>
              <PhotoGallery leadId={j.lead_id} isOnline={isOnline} compact />
            </CardContent>
          </Card>
        )}

        {/* Notes + activity */}
        <Card>
          <CardContent className="p-4 md:p-5">
            <JobActivityTimeline jobId={j.id} />
          </CardContent>
        </Card>
      </div>

      {/* Sticky action bar — mobile-first: Call · Navigate · Start/Complete */}
      {(j.status === "scheduled" || j.status === "dispatched" || j.status === "in_progress") && (
        <div className="sticky-action-bar">
          <div className="sticky-action-bar-inner">
            {/* Quick action: Call customer */}
            {j.customers?.phone ? (
              <a
                href={`tel:${j.customers.phone}`}
                aria-label="Call customer"
                className="sticky-action-icon"
              >
                <Phone className="h-5 w-5 text-primary" />
              </a>
            ) : (
              <button aria-label="No phone" disabled className="sticky-action-icon">
                <Phone className="h-5 w-5" />
              </button>
            )}

            {/* Quick action: Navigate (opens native maps) */}
            {(() => {
              const addr = location?.address_line1
                ? [location.address_line1, location.city].filter(Boolean).join(", ")
                : j.address;
              const href = addr
                ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}`
                : null;
              return href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Navigate to job"
                  className="sticky-action-icon"
                >
                  <Navigation className="h-5 w-5 text-primary" />
                </a>
              ) : (
                <button aria-label="No address" disabled className="sticky-action-icon">
                  <Navigation className="h-5 w-5" />
                </button>
              );
            })()}

            {/* Primary contextual action */}
            {(j.status === "scheduled" || j.status === "dispatched") && (
              <Button
                className="sticky-action-primary bg-primary hover:bg-primary/90 text-white"
                onClick={() => changeStatus("in_progress")}
                disabled={pendingStatus !== null}
              >
                {pendingStatus === "in_progress" ? (
                  <><Loader2 className="h-5 w-5 animate-spin" /> Saving…</>
                ) : (
                  <><Play className="h-5 w-5" /> Start Job</>
                )}
              </Button>
            )}
            {j.status === "in_progress" && (
              <Button
                className="sticky-action-primary bg-green-600 hover:bg-green-700 text-white"
                onClick={() => changeStatus("completed")}
                disabled={pendingStatus !== null}
              >
                {pendingStatus === "completed" ? (
                  <><Loader2 className="h-5 w-5 animate-spin" /> Saving…</>
                ) : (
                  <><CheckCircle2 className="h-5 w-5" /> Complete Job</>
                )}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const AdminJobDetailPageGuarded = () => (
  <RequireRole allowedRoles={["admin", "dispatcher", "field_agent"]}>
    <AdminJobDetailPage />
  </RequireRole>
);

export default AdminJobDetailPageGuarded;
