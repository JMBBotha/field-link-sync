import { Link } from "react-router-dom";
import { CalendarDays, MapPin, FileText, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { appointmentLinks, formatAppointmentWhen, type MyAppointment } from "@/lib/appointments";

interface Props {
  rows: MyAppointment[] | undefined;
  loading?: boolean;
  error?: unknown;
  limit?: number;
}

/** Shared list for the dashboard tile and the full "My appointments" page. */
export default function MyAppointmentsList({ rows, loading, error, limit }: Props) {
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
    <ul className="divide-y divide-border" data-testid="my-appointments-list">
      {list.map((a) => {
        const links = appointmentLinks(a);
        return (
          <li key={`${a.lead_id}-${a.scheduled_date}`} className="py-2.5 flex flex-col gap-1" data-testid="my-appointment-row">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CalendarDays className="h-4 w-4 text-primary shrink-0" />
              <span>{formatAppointmentWhen(a.scheduled_date, a.scheduled_time)}</span>
              {!a.is_mine && <Badge variant="outline" className="text-[10px]">Available</Badge>}
            </div>
            <div className="text-sm">{a.customer_name || "Unnamed client"}{a.service_type ? <span className="text-muted-foreground"> · {a.service_type}</span> : null}</div>
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
          </li>
        );
      })}
    </ul>
  );
}
