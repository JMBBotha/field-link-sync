import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isToday,
  isBefore, addMonths, subMonths, isSameDay, addDays, startOfWeek, endOfWeek,
} from "date-fns";
import { CalendarDays, AlertTriangle, CheckCircle2, Clock, RefreshCw, Search, ChevronLeft, ChevronRight, Loader2, Wrench, ArrowRight, Calendar as CalendarIcon, BarChart3, Percent, List, LayoutGrid, Plus } from "lucide-react";
import RandSign from "@/components/icons/RandSign";

interface MaintenanceSchedule {
  id: string;
  agreement_id: string;
  customer_id: string;
  equipment_id: string | null;
  lead_id: string | null;
  due_date: string;
  status: string;
  reminder_7d_sent: boolean;
  reminder_2d_sent: boolean;
  notes: string | null;
  created_at: string;
  customers?: { name: string; phone: string; address: string | null };
  equipment?: { type: string; brand: string | null; model: string | null; serial_number: string | null };
  service_agreements?: { contract_type: string; frequency: string; price: number };
}

const STATUS_CONFIG: Record<string, { color: string; label: string; icon: React.ElementType }> = {
  upcoming: { color: "bg-emerald-500", label: "On Time", icon: CheckCircle2 },
  scheduled: { color: "bg-blue-500", label: "Scheduled", icon: CalendarDays },
  completed: { color: "bg-green-700", label: "Completed", icon: CheckCircle2 },
  overdue: { color: "bg-red-500", label: "Overdue", icon: AlertTriangle },
  skipped: { color: "bg-muted", label: "Skipped", icon: Clock },
};

const CONTRACT_LABELS: Record<string, string> = {
  annual_ac_maintenance: "Annual AC Maintenance",
  biannual_heater_check: "Bi-Annual Heater Check",
  quarterly_filter: "Quarterly Filter Service",
  monthly_checkup: "Monthly Checkup",
};

const AdminMaintenancePage = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"calendar" | "list">("calendar");

  // Fetch all maintenance schedules
  const { data: schedules = [], isLoading, isError: schedulesError } = useQuery({
    queryKey: ["maintenance-schedules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maintenance_schedules")
        .select(`
          *,
          customers:customer_id (name, phone, address),
          equipment:equipment_id (type, brand, model, serial_number),
          service_agreements:agreement_id (contract_type, frequency, price)
        `)
        .order("due_date", { ascending: true });
      if (error) throw error;
      return (data || []) as MaintenanceSchedule[];
    },
    meta: {
      onError: (err: Error) => toast({ title: "Failed to load schedules", description: err.message, variant: "destructive" }),
    },
  });

  // Metrics queries
  const { data: metrics } = useQuery({
    queryKey: ["maintenance-metrics", schedules],
    queryFn: async () => {
      const total = schedules.length;
      const completed = schedules.filter(s => s.status === "completed").length;
      const overdue = schedules.filter(s => s.status === "overdue" || (s.status === "upcoming" && isBefore(new Date(s.due_date), new Date()))).length;
      const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

      // Recurring revenue from active agreements
      const { data: agreements } = await supabase
        .from("service_agreements")
        .select("price")
        .eq("status", "active");
      const recurringRevenue = agreements?.reduce((s, a) => s + Number(a.price), 0) || 0;

      return { total, completed, overdue, completionRate, recurringRevenue };
    },
    enabled: schedules.length >= 0,
  });

  // Bulk generate mutation
  const generateMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("generate_maintenance_schedules", { months_ahead: 6 });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-schedules"] });
      toast({ title: "Schedules Generated ✅", description: `${count} new maintenance schedules created` });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Mark overdue mutation
  const markOverdueMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("mark_overdue_maintenance");
      if (error) throw error;
      return data as number;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-schedules"] });
      if (count > 0) toast({ title: "Updated", description: `${count} schedules marked as overdue` });
    },
  });

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel("maintenance-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "maintenance_schedules" }, () => {
        queryClient.invalidateQueries({ queryKey: ["maintenance-schedules"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  // Mark overdue on load
  useEffect(() => { markOverdueMutation.mutate(); }, []);

  // Filter logic
  const filteredSchedules = useMemo(() => {
    return schedules.filter(s => {
      // Recompute visual status for upcoming items that are actually overdue
      const effectiveStatus = s.status === "upcoming" && isBefore(new Date(s.due_date), new Date()) ? "overdue" : s.status;
      if (statusFilter !== "all" && effectiveStatus !== statusFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          s.customers?.name?.toLowerCase().includes(q) ||
          s.equipment?.brand?.toLowerCase().includes(q) ||
          s.equipment?.model?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [schedules, statusFilter, searchQuery]);

  // Calendar helpers
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const getSchedulesForDay = useCallback((day: Date) => {
    return filteredSchedules.filter(s => isSameDay(new Date(s.due_date), day));
  }, [filteredSchedules]);

  const getStatusColor = (schedule: MaintenanceSchedule) => {
    if (schedule.status === "completed") return "bg-emerald-500";
    if (schedule.status === "overdue" || (schedule.status === "upcoming" && isBefore(new Date(schedule.due_date), new Date())))
      return "bg-red-500";
    const daysUntil = Math.ceil((new Date(schedule.due_date).getTime() - Date.now()) / 86400000);
    if (daysUntil <= 7) return "bg-amber-500";
    return "bg-emerald-500";
  };

  const getDotColor = (day: Date) => {
    const daySchedules = getSchedulesForDay(day);
    if (daySchedules.length === 0) return null;
    const hasOverdue = daySchedules.some(s => s.status === "overdue" || (s.status === "upcoming" && isBefore(new Date(s.due_date), new Date())));
    if (hasOverdue) return "bg-red-500";
    const hasApproaching = daySchedules.some(s => {
      const daysUntil = Math.ceil((new Date(s.due_date).getTime() - Date.now()) / 86400000);
      return s.status === "upcoming" && daysUntil <= 7;
    });
    if (hasApproaching) return "bg-amber-500";
    return "bg-emerald-500";
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Wrench className="h-6 w-6 text-primary" />
            Maintenance Scheduler
          </h1>
          <p className="text-sm text-muted-foreground">Preventive maintenance scheduling & tracking</p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => navigate("/admin/agreements")}
          >
            <Plus className="mr-2 h-4 w-4" />
            New Agreement
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
          >
            {generateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Generate Schedules
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Percent className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">Completion Rate</span>
            </div>
            <p className="text-2xl font-bold">{metrics?.completionRate ?? 0}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <RandSign className="h-4 w-4 text-emerald-500" />
              <span className="text-xs text-muted-foreground">Recurring Revenue</span>
            </div>
            <p className="text-2xl font-bold">R {(metrics?.recurringRevenue ?? 0).toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              <span className="text-xs text-muted-foreground">Overdue</span>
            </div>
            <p className="text-2xl font-bold text-red-500">{metrics?.overdue ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span className="text-xs text-muted-foreground">Completed</span>
            </div>
            <p className="text-2xl font-bold">{metrics?.completed ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search customer or equipment..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="upcoming">On Time</SelectItem>
            <SelectItem value="scheduled">Scheduled</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="skipped">Skipped</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex border rounded-md">
          <Button variant={viewMode === "calendar" ? "default" : "ghost"} size="sm" onClick={() => setViewMode("calendar")} className="rounded-r-none">
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button variant={viewMode === "list" ? "default" : "ghost"} size="sm" onClick={() => setViewMode("list")} className="rounded-l-none">
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 35 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : schedulesError ? (
        <Card className="p-8 text-center">
          <AlertTriangle className="h-10 w-10 text-destructive mx-auto mb-3" />
          <p className="font-medium">Failed to load maintenance schedules</p>
          <p className="text-sm text-muted-foreground mt-1">Check your connection and try again.</p>
          <Button variant="outline" className="mt-4" onClick={() => window.location.reload()}>Reload</Button>
        </Card>
      ) : viewMode === "calendar" ? (
        /* Calendar View */
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <CardTitle className="text-base">{format(currentMonth, "MMMM yyyy")}</CardTitle>
              <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {/* Day headers */}
            <div className="grid grid-cols-7 gap-1 mb-1">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => (
                <div key={d} className="text-xs font-medium text-muted-foreground text-center py-1">{d}</div>
              ))}
            </div>
            {/* Day cells */}
            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map(day => {
                const daySchedules = getSchedulesForDay(day);
                const dotColor = getDotColor(day);
                return (
                  <div
                    key={day.toISOString()}
                    className={cn(
                      "min-h-[80px] p-1 rounded-md border text-xs transition-colors",
                      !isSameMonth(day, currentMonth) && "opacity-40",
                      isToday(day) && "border-primary bg-primary/5",
                      daySchedules.length > 0 && "cursor-pointer hover:bg-muted/50"
                    )}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className={cn("font-medium", isToday(day) && "text-primary")}>{format(day, "d")}</span>
                      {dotColor && <span className={cn("h-2 w-2 rounded-full", dotColor)} />}
                    </div>
                    <div className="space-y-0.5 overflow-hidden max-h-[52px]">
                      {daySchedules.slice(0, 3).map(s => (
                        <div key={s.id} className={cn("px-1 py-0.5 rounded text-[10px] truncate text-white", getStatusColor(s))}>
                          {s.customers?.name || "Unknown"}
                        </div>
                      ))}
                      {daySchedules.length > 3 && (
                        <div className="text-[10px] text-muted-foreground text-center">+{daySchedules.length - 3} more</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> On Time</div>
              <div className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Approaching (≤7 days)</div>
              <div className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Overdue</div>
            </div>
          </CardContent>
        </Card>
      ) : (
        /* List View */
        <div className="space-y-3">
          {filteredSchedules.length === 0 ? (
            <Card className="p-8 text-center">
              <Wrench className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No maintenance schedules found</p>
              <p className="text-sm text-muted-foreground mt-1">Create a Service Agreement first, then generate schedules.</p>
              <div className="flex gap-2 justify-center mt-4">
                <Button onClick={() => navigate("/admin/agreements")}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Agreement
                </Button>
                <Button variant="outline" onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
                  Generate from Agreements
                </Button>
              </div>
            </Card>
          ) : (
            filteredSchedules.map(schedule => {
              const effectiveStatus = schedule.status === "upcoming" && isBefore(new Date(schedule.due_date), new Date()) ? "overdue" : schedule.status;
              const config = STATUS_CONFIG[effectiveStatus] || STATUS_CONFIG.upcoming;
              const contractLabel = CONTRACT_LABELS[schedule.service_agreements?.contract_type || ""] || schedule.service_agreements?.contract_type || "Maintenance";

              return (
                <Card key={schedule.id} className={cn("transition-colors", effectiveStatus === "overdue" && "border-red-500/30")}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-semibold truncate">{schedule.customers?.name || "Unknown"}</p>
                          <Badge className={cn(config.color, "text-white text-[10px]")}>{config.label}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{contractLabel}</p>
                        {schedule.equipment && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {schedule.equipment.brand} {schedule.equipment.model}
                            {schedule.equipment.serial_number && ` • S/N: ${schedule.equipment.serial_number}`}
                          </p>
                        )}
                        {schedule.customers?.address && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">{schedule.customers.address}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-medium">{format(new Date(schedule.due_date), "dd MMM yyyy")}</p>
                        <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                          {schedule.reminder_7d_sent && <Badge variant="outline" className="text-[10px] px-1">7d ✓</Badge>}
                          {schedule.reminder_2d_sent && <Badge variant="outline" className="text-[10px] px-1">2d ✓</Badge>}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      )}

    </div>
  );
};

export default AdminMaintenancePage;
