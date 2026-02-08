import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

interface JobTimelineProps {
  leadId: string;
  lead: {
    created_at?: string | null;
    started_at?: string | null;
    completed_at?: string | null;
    assigned_agent_id?: string | null;
    status: string;
  };
}

interface TimelineEvent {
  date: string;
  label: string;
  detail?: string;
  color: string;
}

const DOT_COLORS: Record<string, string> = {
  blue: "bg-blue-500",
  indigo: "bg-indigo-500",
  green: "bg-green-500",
  amber: "bg-amber-500",
  purple: "bg-purple-500",
  emerald: "bg-emerald-500",
  red: "bg-red-500",
  yellow: "bg-yellow-500",
};

const JobTimeline = ({ leadId, lead }: JobTimelineProps) => {
  // Fetch related quote
  const { data: quote } = useQuery({
    queryKey: ["job-timeline-quote", leadId],
    queryFn: async () => {
      const { data } = await supabase
        .from("quotes")
        .select("id, status, created_at, sent_at, viewed_at, accepted_at, declined_at, quote_number")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  // Fetch time entries for timeline dots
  const { data: timeEntries = [] } = useQuery({
    queryKey: ["job-timeline-time", leadId],
    queryFn: async () => {
      const { data } = await supabase
        .from("job_time_entries")
        .select("work_date, hours_onsite, travel_hours")
        .eq("lead_id", leadId)
        .order("work_date", { ascending: true });
      return data || [];
    },
  });

  // Fetch agent profile name
  const { data: agentProfile } = useQuery({
    queryKey: ["job-timeline-agent", lead.assigned_agent_id],
    enabled: !!lead.assigned_agent_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", lead.assigned_agent_id!)
        .maybeSingle();
      return data;
    },
  });

  // Build timeline events
  const events: TimelineEvent[] = [];

  // Lead created
  if (lead.created_at) {
    events.push({
      date: lead.created_at,
      label: "Lead Created",
      color: "blue",
    });
  }

  // Quote events
  if (quote) {
    events.push({
      date: quote.created_at,
      label: `Quote Created (${quote.quote_number})`,
      color: "blue",
    });
    if (quote.sent_at) {
      events.push({ date: quote.sent_at, label: "Quote Sent", color: "indigo" });
    }
    if (quote.viewed_at) {
      events.push({ date: quote.viewed_at, label: "Quote Viewed", color: "yellow" });
    }
    if (quote.accepted_at) {
      events.push({ date: quote.accepted_at, label: "Quote Accepted", color: "green" });
    }
    if (quote.declined_at) {
      events.push({ date: quote.declined_at, label: "Quote Declined", color: "red" });
    }
  }

  // Agent assigned
  if (lead.assigned_agent_id && lead.started_at) {
    events.push({
      date: lead.started_at,
      label: "Agent Assigned",
      detail: agentProfile?.full_name || "Field Agent",
      color: "amber",
    });
  }

  // Time entry days
  const groupedTime = timeEntries.reduce<Record<string, number>>((acc, e) => {
    const key = e.work_date;
    acc[key] = (acc[key] || 0) + Number(e.hours_onsite) + Number(e.travel_hours);
    return acc;
  }, {});

  Object.entries(groupedTime).forEach(([dateStr, totalHours]) => {
    events.push({
      date: dateStr + "T12:00:00Z",
      label: `Work Day`,
      detail: `${totalHours.toFixed(1)}h logged`,
      color: "purple",
    });
  });

  // Completed
  if (lead.completed_at) {
    events.push({
      date: lead.completed_at,
      label: "Job Completed",
      color: "emerald",
    });
  }

  // Sort chronologically
  events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (events.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        No timeline events yet
      </div>
    );
  }

  return (
    <div className="relative pl-6 space-y-0">
      {/* Vertical line */}
      <div className="absolute left-[11px] top-3 bottom-3 w-0.5 bg-border" />

      {events.map((event, i) => {
        const dotClass = DOT_COLORS[event.color] || "bg-muted-foreground";
        let displayDate: string;
        try {
          displayDate = format(parseISO(event.date), "dd MMM yyyy, HH:mm");
        } catch {
          try {
            displayDate = format(parseISO(event.date), "dd MMM yyyy");
          } catch {
            displayDate = event.date;
          }
        }

        return (
          <div key={i} className="relative pb-5 last:pb-0">
            {/* Dot */}
            <div className={`absolute -left-6 top-1.5 w-[14px] h-[14px] rounded-full border-2 border-background ${dotClass} shadow-sm z-10`} />

            {/* Card */}
            <div className="rounded-lg border bg-card p-3 shadow-sm ml-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-foreground">{event.label}</p>
              </div>
              {event.detail && (
                <p className="text-xs text-muted-foreground mt-0.5">{event.detail}</p>
              )}
              <p className="text-[10px] text-muted-foreground mt-1">{displayDate}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default JobTimeline;
