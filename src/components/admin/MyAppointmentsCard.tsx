import { Link } from "react-router-dom";
import { CalendarDays } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMyAppointments } from "@/hooks/useMyAppointments";
import MyAppointmentsList from "./MyAppointmentsList";

/** Rep dashboard tile: next few own/available appointments, soonest first. */
export default function MyAppointmentsCard({ limit = 5 }: { limit?: number }) {
  const { data, isLoading, error } = useMyAppointments();
  const total = data?.length ?? 0;
  return (
    <Card className="surface-card" data-testid="my-appointments-card">
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary" /> My upcoming appointments{total ? ` (${total})` : ""}
        </CardTitle>
        <Link to="/admin/my-appointments" className="text-xs text-primary hover:underline">View all</Link>
      </CardHeader>
      <CardContent className="pt-0">
        <MyAppointmentsList rows={data} loading={isLoading} error={error} limit={limit} />
      </CardContent>
    </Card>
  );
}
