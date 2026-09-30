import { CalendarDays } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useMyAppointments } from "@/hooks/useMyAppointments";
import MyAppointmentsList from "@/components/admin/MyAppointmentsList";

/** Full list of the signed-in user's own upcoming appointments (+ unassigned-available ones), next 60 days. */
const AdminMyAppointmentsPage = () => {
  const { data, isLoading, error } = useMyAppointments(60);
  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-3xl">
      <div className="flex items-center gap-2">
        <CalendarDays className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold">My appointments</h1>
      </div>
      <p className="text-sm text-muted-foreground">Your upcoming site visits and bookings for the next 60 days, soonest first. "Available" ones are not assigned to anyone yet.</p>
      <Card className="surface-card">
        <CardContent className="p-4">
          <MyAppointmentsList rows={data} loading={isLoading} error={error} />
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminMyAppointmentsPage;
