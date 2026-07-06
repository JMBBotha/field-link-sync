import JobsMapCard from "@/components/admin/JobsMapCard";
import RequireRole from "@/components/RequireRole";

const AdminJobsMapPage = () => (
  <div className="p-4 md:p-6 space-y-4">
    <h1 className="text-2xl font-bold text-foreground">Jobs Map</h1>
    <JobsMapCard fullPage />
  </div>
);

const Guarded = () => (
  <RequireRole allowedRoles={["admin"]}>
    <AdminJobsMapPage />
  </RequireRole>
);

export default Guarded;
