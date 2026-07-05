import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parse, addMinutes, isSameDay } from "date-fns";
import { CalendarIcon, Clock, User, Sparkles, CheckCircle2, AlertTriangle, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface AppointmentValue {
  /** ISO date "YYYY-MM-DD" */
  date: string;
  /** "HH:mm" */
  startTime: string;
  /** Duration in minutes */
  durationMinutes: number;
  /** Selected agent id (empty string = unassigned) */
  agentId: string;
}

interface AppointmentPickerProps {
  value: AppointmentValue;
  onChange: (v: AppointmentValue) => void;
  /** Show the agent picker section */
  showAgentPicker?: boolean;
  className?: string;
}

const DURATIONS = [
  { label: "30 min", value: 30 },
  { label: "1 h", value: 60 },
  { label: "2 h", value: 120 },
  { label: "4 h", value: 240 },
  { label: "All day", value: 480 },
];

// Hourly & half-hour slots 07:00–17:00 (HVAC standard workday)
const TIME_SLOTS: string[] = (() => {
  const out: string[] = [];
  for (let h = 7; h <= 17; h++) {
    out.push(`${String(h).padStart(2, "0")}:00`);
    if (h < 17) out.push(`${String(h).padStart(2, "0")}:30`);
  }
  return out;
})();

const toMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
};

const AppointmentPicker = ({ value, onChange, showAgentPicker = true, className }: AppointmentPickerProps) => {
  const [calendarOpen, setCalendarOpen] = useState(false);

  const selectedDate = useMemo(() => {
    if (!value.date) return undefined;
    return parse(value.date, "yyyy-MM-dd", new Date());
  }, [value.date]);

  // Fetch field agents
  const { data: agents = [] } = useQuery({
    queryKey: ["appointment-agents"],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .in("role", ["field_agent"] as any);
      if (!roles?.length) return [];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", roles.map((r: any) => r.user_id));
      return profiles || [];
    },
  });

  // Fetch same-day schedules for conflict/availability display
  const { data: daySchedules = [] } = useQuery({
    queryKey: ["appointment-day-schedules", value.date],
    enabled: !!value.date,
    queryFn: async () => {
      const { data } = await supabase
        .from("job_schedules")
        .select("id, agent_id, start_time, end_time")
        .eq("scheduled_date", value.date);
      return data || [];
    },
  });

  // Per-agent status for the currently selected slot
  const slotEnd = useMemo(() => {
    if (!value.startTime) return null;
    const start = parse(value.startTime, "HH:mm", new Date());
    return format(addMinutes(start, value.durationMinutes), "HH:mm");
  }, [value.startTime, value.durationMinutes]);

  const agentStatus = useMemo(() => {
    const map = new Map<string, { busy: boolean; conflictLabel?: string; jobsToday: number }>();
    agents.forEach((a: any) => {
      const own = daySchedules.filter((s: any) => s.agent_id === a.id);
      let busy = false;
      let conflictLabel: string | undefined;
      if (value.startTime && slotEnd) {
        const overlap = own.find((s: any) => value.startTime < s.end_time && slotEnd > s.start_time);
        if (overlap) {
          busy = true;
          conflictLabel = `${overlap.start_time.slice(0, 5)}–${overlap.end_time.slice(0, 5)}`;
        }
      }
      map.set(a.id, { busy, conflictLabel, jobsToday: own.length });
    });
    return map;
  }, [agents, daySchedules, value.startTime, slotEnd]);

  // Auto-assign: pick agent with fewest jobs today, not busy for slot
  const autoAssign = () => {
    if (agents.length === 0) return;
    const ranked = [...agents].sort((a: any, b: any) => {
      const sa = agentStatus.get(a.id);
      const sb = agentStatus.get(b.id);
      const busyA = sa?.busy ? 1 : 0;
      const busyB = sb?.busy ? 1 : 0;
      if (busyA !== busyB) return busyA - busyB;
      return (sa?.jobsToday || 0) - (sb?.jobsToday || 0);
    });
    onChange({ ...value, agentId: ranked[0].id });
  };

  // Highlight slots that already have any booking today (visual busy hint)
  const slotIsBusy = (slot: string) => {
    if (!value.agentId) {
      // If no agent chosen, mark as busy only if ALL agents are busy at that time
      const someoneFree = agents.some((a: any) => {
        const own = daySchedules.filter((s: any) => s.agent_id === a.id);
        const end = format(addMinutes(parse(slot, "HH:mm", new Date()), value.durationMinutes), "HH:mm");
        return !own.some((s: any) => slot < s.end_time && end > s.start_time);
      });
      return !someoneFree && agents.length > 0;
    }
    const own = daySchedules.filter((s: any) => s.agent_id === value.agentId);
    const end = format(addMinutes(parse(slot, "HH:mm", new Date()), value.durationMinutes), "HH:mm");
    return own.some((s: any) => slot < s.end_time && end > s.start_time);
  };

  return (
    <div className={cn("space-y-4", className)}>
      {/* Date + duration row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Date
          </label>
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full h-11 justify-start text-left font-normal gap-2",
                  !selectedDate && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="h-4 w-4 shrink-0" />
                {selectedDate
                  ? format(selectedDate, "EEE dd MMM yyyy")
                  : "Pick a date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 pointer-events-auto" align="start">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(d) => {
                  if (!d) return;
                  onChange({ ...value, date: format(d, "yyyy-MM-dd") });
                  setCalendarOpen(false);
                }}
                disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Duration
          </label>
          <div className="flex flex-wrap gap-1.5">
            {DURATIONS.map((d) => (
              <button
                key={d.value}
                type="button"
                onClick={() => onChange({ ...value, durationMinutes: d.value })}
                className={cn(
                  "px-3 h-9 rounded-lg text-xs font-medium border transition-colors",
                  value.durationMinutes === d.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:bg-muted"
                )}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Time slot grid */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <Clock className="h-3 w-3" /> Start time
          {slotEnd && value.startTime && (
            <span className="normal-case text-[10px] text-muted-foreground/80">
              · ends {slotEnd}
            </span>
          )}
        </label>
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
          {TIME_SLOTS.map((slot) => {
            const selected = value.startTime === slot;
            const busy = slotIsBusy(slot);
            return (
              <button
                key={slot}
                type="button"
                onClick={() => onChange({ ...value, startTime: slot })}
                className={cn(
                  "h-10 rounded-lg text-xs font-medium border transition-all relative",
                  selected
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : busy
                    ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 hover:bg-red-100"
                    : "bg-background border-border hover:bg-muted text-foreground"
                )}
                title={busy ? "Booked" : "Available"}
              >
                {slot}
                {busy && !selected && (
                  <span className="absolute top-0.5 right-1 h-1.5 w-1.5 rounded-full bg-red-500" />
                )}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground flex items-center gap-3 pt-0.5">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-red-500" /> Booked
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-primary" /> Selected
          </span>
        </p>
      </div>

      {/* Agent picker */}
      {showAgentPicker && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <Users className="h-3 w-3" /> Technician
            </label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1 text-primary"
              onClick={autoAssign}
              disabled={agents.length === 0}
            >
              <Sparkles className="h-3 w-3" /> Auto-assign
            </Button>
          </div>

          {agents.length === 0 ? (
            <p className="text-xs text-muted-foreground italic px-1">
              No field technicians available yet.
            </p>
          ) : (
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => onChange({ ...value, agentId: "" })}
                className={cn(
                  "w-full flex items-center justify-between gap-2 p-2.5 rounded-lg border text-left transition-colors",
                  value.agentId === ""
                    ? "bg-primary/5 border-primary"
                    : "bg-background border-border hover:bg-muted"
                )}
              >
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                    <User className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <span className="text-sm font-medium">Unassigned</span>
                </div>
                <span className="text-[10px] text-muted-foreground">
                  Assign later
                </span>
              </button>

              {agents.map((a: any) => {
                const st = agentStatus.get(a.id);
                const selected = value.agentId === a.id;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => onChange({ ...value, agentId: a.id })}
                    className={cn(
                      "w-full flex items-center justify-between gap-2 p-2.5 rounded-lg border text-left transition-colors",
                      selected
                        ? "bg-primary/5 border-primary border-l-4 border-l-accent-yellow"
                        : "bg-background border-border hover:bg-muted"
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">
                        {(a.full_name || "?").slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{a.full_name || "Unnamed"}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {st?.jobsToday || 0} job{(st?.jobsToday || 0) === 1 ? "" : "s"} today
                        </p>
                      </div>
                    </div>
                    {st?.busy ? (
                      <Badge variant="destructive" className="text-[10px] gap-1 shrink-0">
                        <AlertTriangle className="h-3 w-3" /> {st.conflictLabel}
                      </Badge>
                    ) : value.startTime ? (
                      <Badge className="text-[10px] gap-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300 shrink-0">
                        <CheckCircle2 className="h-3 w-3" /> Free
                      </Badge>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AppointmentPicker;
