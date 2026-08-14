import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Clock, Car, Loader2 } from "lucide-react";
import RandSign from "@/components/icons/RandSign";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";

interface TimeEntryListProps {
  leadId: string;
  refreshKey?: number;
}

interface TimeEntry {
  id: string;
  work_date: string;
  start_time: string;
  end_time: string;
  hours_onsite: number;
  travel_hours: number;
  is_billable: boolean;
  notes: string | null;
  agent_id: string;
}

const TimeEntryList = ({ leadId, refreshKey }: TimeEntryListProps) => {
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["job-time-entries", leadId, refreshKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_time_entries")
        .select("*")
        .eq("lead_id", leadId)
        .order("work_date", { ascending: true })
        .order("start_time", { ascending: true });
      if (error) throw error;
      return data as TimeEntry[];
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        <Clock className="h-8 w-8 mx-auto mb-2 opacity-30" />
        No time entries yet
      </div>
    );
  }

  // Group by date
  const grouped = entries.reduce<Record<string, TimeEntry[]>>((acc, entry) => {
    const key = entry.work_date;
    if (!acc[key]) acc[key] = [];
    acc[key].push(entry);
    return acc;
  }, {});

  const totalBillableHours = entries
    .filter((e) => e.is_billable)
    .reduce((sum, e) => sum + Number(e.hours_onsite) + Number(e.travel_hours), 0);

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([dateStr, dayEntries], dayIndex) => {
        const date = parseISO(dateStr);
        const dayTotal = dayEntries.reduce(
          (sum, e) => sum + Number(e.hours_onsite) + Number(e.travel_hours),
          0
        );

        return (
          <div key={dateStr} className="space-y-2">
            {/* Day Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-foreground">
                  Day {dayIndex + 1}
                </span>
                <span className="text-xs text-muted-foreground">
                  {dayNames[date.getDay()]}, {format(date, "dd MMM")}
                </span>
              </div>
              <span className="text-xs font-semibold text-primary">
                {dayTotal.toFixed(1)}h
              </span>
            </div>

            {/* Entries for this day */}
            {dayEntries.map((entry) => (
              <div
                key={entry.id}
                className="rounded-lg border bg-card p-3 space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>
                      {entry.start_time.slice(0, 5)} – {entry.end_time.slice(0, 5)}
                    </span>
                    <span className="text-muted-foreground">
                      ({Number(entry.hours_onsite).toFixed(1)}h)
                    </span>
                  </div>
                  <Badge
                    variant={entry.is_billable ? "default" : "secondary"}
                    className="text-[10px] px-1.5 py-0"
                  >
                    {entry.is_billable ? "Billable" : "Non-billable"}
                  </Badge>
                </div>

                {Number(entry.travel_hours) > 0 && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Car className="h-3.5 w-3.5" />
                    <span>Travel: {Number(entry.travel_hours).toFixed(1)}h</span>
                  </div>
                )}

                {entry.notes && (
                  <p className="text-xs text-muted-foreground pl-5">
                    {entry.notes}
                  </p>
                )}
              </div>
            ))}
          </div>
        );
      })}

      {/* Running Total */}
      <div className="rounded-lg bg-primary/10 p-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <RandSign className="h-4 w-4 text-primary" />
          Total Billable
        </div>
        <div className="text-right">
          <div className="text-sm font-bold">{totalBillableHours.toFixed(1)}h</div>
          <div className="text-xs text-primary font-medium">
            R{(totalBillableHours * 450).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TimeEntryList;
