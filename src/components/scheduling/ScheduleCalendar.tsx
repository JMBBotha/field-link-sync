import { useState, useCallback, useMemo, useEffect } from "react";
import { Calendar, dateFnsLocalizer, Views, SlotInfo } from "react-big-calendar";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { enUS } from "date-fns/locale/en-US";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, Plus, RefreshCw } from "lucide-react";
import ScheduleJobModal from "./ScheduleJobModal";
import "react-big-calendar/lib/css/react-big-calendar.css";

const locales = { "en-US": enUS };
const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales });


interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resource: {
    leadId: string;
    agentId: string;
    agentName: string;
    customerName: string;
    serviceType: string;
    status: string;
    notes?: string;
  };
}

const statusColorMap: Record<string, string> = {
  pending: "#3b82f6",
  accepted: "#3b82f6",
  in_progress: "#22c55e",
  completed: "#6b7280",
};

const ScheduleCalendar = () => {
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<{ date: Date; start?: Date; end?: Date } | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [currentView, setCurrentView] = useState<(typeof Views)[keyof typeof Views]>(
    typeof window !== "undefined" && window.innerWidth < 640 ? Views.DAY : Views.WEEK
  );
  const queryClient = useQueryClient();

  // Auto-switch to Day view on narrow screens (mobile)
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 640) {
      setCurrentView(Views.DAY);
    }
  }, []);

  // Realtime: refresh calendar when jobs, schedules, or assignments change
  useEffect(() => {
    const ch = supabase
      .channel("schedule-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "job_schedules" }, () =>
        queryClient.invalidateQueries({ queryKey: ["job-schedules"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, () =>
        queryClient.invalidateQueries({ queryKey: ["job-schedules"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "assignments" }, () =>
        queryClient.invalidateQueries({ queryKey: ["job-schedules"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [queryClient]);

  const { data: schedules = [], refetch } = useQuery({
    queryKey: ["job-schedules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_schedules")
        .select("*, leads(customer_name, service_type, status)")
        .order("scheduled_date");
      if (error) throw error;

      // Fetch agent names
      const agentIds = [...new Set(data.map((s: any) => s.agent_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", agentIds);
      const profileMap = new Map((profiles || []).map((p: any) => [p.id, p.full_name]));

      return data.map((s: any) => ({
        ...s,
        agent_name: profileMap.get(s.agent_id) || "Unknown",
      }));
    },
  });

  const events: CalendarEvent[] = useMemo(
    () =>
      schedules.map((s: any) => {
        const dateStr = s.scheduled_date;
        const startParts = s.start_time.split(":");
        const endParts = s.end_time.split(":");
        const start = new Date(dateStr);
        start.setHours(parseInt(startParts[0]), parseInt(startParts[1]), 0);
        const end = new Date(dateStr);
        end.setHours(parseInt(endParts[0]), parseInt(endParts[1]), 0);

        const lead = s.leads;
        return {
          id: s.id,
          title: `${lead?.customer_name || "Job"} — ${s.agent_name}`,
          start,
          end,
          resource: {
            leadId: s.lead_id,
            agentId: s.agent_id,
            agentName: s.agent_name,
            customerName: lead?.customer_name || "",
            serviceType: lead?.service_type || "",
            status: lead?.status || "pending",
            notes: s.notes,
          },
        };
      }),
    [schedules]
  );

  const handleSelectSlot = useCallback((slotInfo: SlotInfo) => {
    setSelectedEvent(null);
    setSelectedSlot({ date: slotInfo.start, start: slotInfo.start, end: slotInfo.end });
    setModalOpen(true);
  }, []);

  const handleSelectEvent = useCallback((event: CalendarEvent) => {
    setSelectedSlot(null);
    setSelectedEvent(event);
    setModalOpen(true);
  }, []);

  const eventStyleGetter = useCallback((event: CalendarEvent) => {
    const bg = statusColorMap[event.resource.status] || "#3b82f6";
    return {
      style: {
        backgroundColor: bg,
        borderRadius: "6px",
        opacity: 0.9,
        color: "white",
        border: "none",
        fontSize: "12px",
        padding: "2px 6px",
      },
    };
  }, []);

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CalendarDays className="h-6 w-6 text-primary" />
          <h2 className="text-xl font-bold">Job Schedule</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-2 mr-4">
            <Badge className="bg-blue-500 text-white text-xs">Scheduled</Badge>
            <Badge className="bg-green-500 text-white text-xs">In Progress</Badge>
            <Badge className="bg-gray-500 text-white text-xs">Completed</Badge>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
          <Button onClick={() => { setSelectedSlot({ date: new Date() }); setSelectedEvent(null); setModalOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" /> Schedule Job
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-2 sm:p-4">
          <div style={{ height: "calc(100vh - 250px)", minHeight: "500px" }}>
            <Calendar
              localizer={localizer}
              events={events}
              startAccessor="start"
              endAccessor="end"
              selectable
              onSelectSlot={handleSelectSlot}
              onSelectEvent={handleSelectEvent}
              eventPropGetter={eventStyleGetter}
              defaultView={Views.WEEK}
              view={currentView}
              onView={setCurrentView}
              date={currentDate}
              onNavigate={setCurrentDate}
              views={[Views.MONTH, Views.WEEK, Views.DAY]}
              step={30}
              timeslots={2}
              min={new Date(2020, 0, 1, 6, 0)}
              max={new Date(2020, 0, 1, 20, 0)}
              formats={{
                eventTimeRangeFormat: () => "",
              }}
            />
          </div>
        </CardContent>
      </Card>

      <ScheduleJobModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        selectedDate={selectedSlot?.date}
        selectedStart={selectedSlot?.start}
        selectedEnd={selectedSlot?.end}
        existingEvent={selectedEvent ? {
          id: selectedEvent.id,
          leadId: selectedEvent.resource.leadId,
          agentId: selectedEvent.resource.agentId,
          notes: selectedEvent.resource.notes,
        } : undefined}
        existingSchedules={schedules}
        onSaved={refetch}
      />
    </div>
  );
};

export default ScheduleCalendar;
