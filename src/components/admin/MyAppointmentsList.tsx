import { Link, useNavigate } from "react-router-dom";
import { CalendarDays, MapPin, FileText, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { appointmentLinks, formatAppointmentWhen, type MyAppointment } from "@/lib/appointments";
import JobCard from "@/components/cards/JobCard";
import { scheduleRowToCard } from "@/lib/cardModel";

interface Props {
  rows: MyAppointment[] | undefined;
  loading?: boolean;
  error?: unknown;
  limit?: number;
}

/** Shared list for the dashboard tile and the full "My appointments" page. */
export default function MyAppointmentsList({ rows, loading, error, limit }: Props) {
  const navigate = useNavigate();
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-md" />)}
      </div>
    );
  }
  if (error) return <p className="text-sm text-destructive">Could not load appointments.</p>;
  const list = limit ? (rows ?? []).slice(0, limit) : rows ?? [];
  if (list.length === 0) return <p className="text-sm text-muted-foreground">No upcoming appointments.</p>;
  return (
    <ul className="space-y-3" data-testid="my-appointments-list">
      {list.map((a) => {
        const links = appointmentLinks(a);
        return (
          <li key={`${a.lead_id}-${a.scheduled_date}`}>
            <JobCard data-testid="my-appointment-row" density="compact" audience="sales" onOpen={() => navigate(links.lead)}
              item={{ ...scheduleRowToCard({ key: `appointment:${a.lead_id}`, lead_id: a.lead_id, job_id: null,
                date: a.scheduled_date, start_time: a.scheduled_time, customer_name: a.customer_name,
                customer_address: a.address, status: a.status, primary_intent: "sales" }),
                title: a.customer_name || "Unnamed client", clientName: a.service_type, assigneeName: a.is_mine ? "You" : null,
                statusKey: a.status || "pending" }} actions={<div className="w-full space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
              <CalendarDays className="h-4 w-4 text-primary shrink-0" />
              <span>{formatAppointmentWhen(a.scheduled_date, a.scheduled_time)}</span>
              {!a.is_mine && <Badge variant="outline" className="text-[10px]">Available</Badge>}
            </div>
            {a.address && (
              <div className="flex items-start gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{a.address}</span>
              </div>
            )}
            <div className="flex gap-3 text-xs">
              <Link to={links.lead} className="inline-flex items-center gap-1 text-primary hover:underline">
                <ExternalLink className="h-3 w-3" /> Lead
              </Link>
              <Link to={links.quote} className="inline-flex items-center gap-1 text-primary hover:underline">
                <FileText className="h-3 w-3" /> {links.quoteLabel}
              </Link>
            </div>
            </div>} />
          </li>
        );
      })}
    </ul>
  );
}
