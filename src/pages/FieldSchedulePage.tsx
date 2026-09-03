import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MapPin, CalendarDays, Phone, Navigation, RefreshCw } from "lucide-react";
import { JobCardListSkeleton } from "@/components/ui/skeletons";
import FieldAgentBottomNav from "@/components/FieldAgentBottomNav";
import DepositPaymentChip from "@/components/shared/DepositPaymentChip";
import { format, isToday, isTomorrow, isThisWeek, startOfDay } from "date-fns";

type MyAssignedJobRow = {
  assignment_id: string;
  assignment_status: string | null;
  job_id: string;
  job_title: string | null;
  job_address: string | null;
  job_status: string | null;
  job_scheduled_for: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  job_type: string | null;
  deposit_invoice_id: string | null;
  deposit_invoice_status: string | null;
  deposit_invoice_paid_date: string | null;
  deposit_invoice_grand_total: number | null;
  deposit_invoice_amount_paid: number | null;
  deposit_invoice_remaining: number | null;

};

const STATUS_TONE: Record<string, string> = {
  proposed: "bg-amber-100 text-amber-800",
  accepted: "bg-blue-100 text-blue-800",
  in_progress: "bg-green-100 text-green-800",
  completed: "bg-muted text-muted-foreground",
};

const bucketLabel = (d: Date) => {
  if (isToday(d)) return "Today";
  if (isTomorrow(d)) return "Tomorrow";
  if (isThisWeek(d, { weekStartsOn: 1 })) return format(d, "EEEE");
  return format(d, "EEE, dd MMM");
};

const FieldSchedulePage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: rows = [], isLoading } = useQuery<MyAssignedJobRow[]>({
    queryKey: ["my-jobs", user?.id, "schedule"],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_my_assigned_jobs", { p_profile_id: user!.id });
      if (error) throw error;
      return (data as MyAssignedJobRow[] | null) ?? [];
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel("field-schedule-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, () =>
        queryClient.invalidateQueries({ queryKey: ["my-jobs"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "assignments" }, () =>
        queryClient.invalidateQueries({ queryKey: ["my-jobs"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [queryClient]);

  // Sort scheduled jobs ascending and group into day buckets
  const grouped = useMemo(() => {
    const scheduled = rows
      .filter((r) => r.job_scheduled_for && !["completed", "rejected"].includes(r.assignment_status ?? ""))
      .sort((a, b) => new Date(a.job_scheduled_for!).getTime() - new Date(b.job_scheduled_for!).getTime());

    const buckets = new Map<string, { label: string; date: Date; items: MyAssignedJobRow[] }>();
    for (const r of scheduled) {
      const d = startOfDay(new Date(r.job_scheduled_for!));
      const key = d.toISOString();
      if (!buckets.has(key)) buckets.set(key, { label: bucketLabel(d), date: d, items: [] });
      buckets.get(key)!.items.push(r);
    }
    return Array.from(buckets.values());
  }, [rows]);

  const unscheduled = useMemo(
    () => rows.filter((r) => !r.job_scheduled_for && !["completed", "rejected"].includes(r.assignment_status ?? "")),
    [rows]
  );

  return (
    <div className="min-h-screen bg-background pb-32">
      <div className="max-w-3xl mx-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Schedule</h1>
          <Button
            size="sm"
            variant="outline"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["my-jobs"] })}
          >
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
        </div>

        {isLoading ? (
          <JobCardListSkeleton rows={3} />
        ) : grouped.length === 0 && unscheduled.length === 0 ? (
          <div className="flex flex-col items-center gap-2 text-center py-20 text-muted-foreground">
            <CalendarDays className="h-10 w-10 opacity-40" />
            <p className="text-sm">No upcoming jobs</p>
          </div>
        ) : (
          <>
            {grouped.map((bucket) => (
              <section key={bucket.date.toISOString()} className="space-y-2">
                <div className="flex items-baseline justify-between px-1">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {bucket.label}
                  </h2>
                  <span className="text-xs text-muted-foreground">{format(bucket.date, "dd MMM")}</span>
                </div>
                <div className="grid gap-2">
                  {bucket.items.map((r) => (
                    <Card
                      key={r.assignment_id}
                      className="overflow-hidden active:scale-[0.99] transition-transform cursor-pointer"
                      onClick={() => navigate(`/admin/jobs/${r.job_id}`)}
                    >
                      <CardContent className="p-4 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-lg font-semibold tabular-nums">
                                {format(new Date(r.job_scheduled_for!), "HH:mm")}
                              </span>
                              <span
                                className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                                  STATUS_TONE[r.assignment_status ?? "proposed"] ?? STATUS_TONE.proposed
                                }`}
                              >
                                {(r.assignment_status ?? "proposed").replace(/_/g, " ")}
                              </span>
                              {r.job_type === "installation" && r.deposit_invoice_id && (
                                <DepositPaymentChip
                                  invoice={{
                                    id: r.deposit_invoice_id,
                                    status: r.deposit_invoice_status,
                                    paid_date: r.deposit_invoice_paid_date,
                                    grand_total: r.deposit_invoice_grand_total,
                                    amount_paid: r.deposit_invoice_amount_paid,
                                    remaining: r.deposit_invoice_remaining,
                                  }}

                                  accepted
                                  className="text-[10px]"
                                />
                              )}
                            </div>
                            <div className="font-medium leading-tight truncate">{r.job_title ?? "Job"}</div>
                            {r.customer_name && (
                              <div className="text-sm text-muted-foreground truncate">{r.customer_name}</div>
                            )}
                            {r.job_address && (
                              <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1">
                                <MapPin className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{r.job_address}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {(r.customer_phone || r.job_address) && (
                          <div className="flex gap-2 pt-1">
                            {r.customer_phone && (
                              <Button
                                asChild
                                size="sm"
                                variant="outline"
                                className="flex-1 h-10"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <a href={`tel:${r.customer_phone}`}>
                                  <Phone className="h-4 w-4 mr-1.5" /> Call
                                </a>
                              </Button>
                            )}
                            {r.job_address && (
                              <Button
                                asChild
                                size="sm"
                                variant="outline"
                                className="flex-1 h-10"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <a
                                  href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(r.job_address)}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  <Navigation className="h-4 w-4 mr-1.5" /> Navigate
                                </a>
                              </Button>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            ))}

            {unscheduled.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground px-1">
                  Unscheduled
                </h2>
                <div className="grid gap-2">
                  {unscheduled.map((r) => (
                    <Card
                      key={r.assignment_id}
                      className="cursor-pointer active:scale-[0.99] transition-transform"
                      onClick={() => navigate(`/admin/jobs/${r.job_id}`)}
                    >
                      <CardContent className="p-4">
                        <div className="font-medium truncate">{r.job_title ?? "Job"}</div>
                        {r.customer_name && (
                          <div className="text-sm text-muted-foreground truncate">{r.customer_name}</div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      <FieldAgentBottomNav />
    </div>
  );
};

export default FieldSchedulePage;
