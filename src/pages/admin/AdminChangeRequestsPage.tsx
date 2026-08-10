import ChangeRequestsManager from "@/components/ChangeRequestsManager";

const AdminChangeRequestsPage = () => {
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Change Requests</h1>
        <p className="text-sm text-muted-foreground">
          Approve or reject customer and staff requests to reschedule or cancel bookings.
        </p>
      </div>
      <ChangeRequestsManager showAll />
    </div>
  );
};

export default AdminChangeRequestsPage;
