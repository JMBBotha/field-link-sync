import { useNavigate } from "react-router-dom";
import ErrorBoundary from "@/components/ErrorBoundary";
import AdminHome from "@/components/AdminHome";
import CreateLeadDialog from "@/components/CreateLeadDialog";
import { useState } from "react";

const AdminHomePage = () => {
  const navigate = useNavigate();
  const [showCreateLead, setShowCreateLead] = useState(false);

  const tabToRoute: Record<string, string> = {
    home: "/admin",
    map: "/admin/map",
    dispatch: "/admin/dispatch",
    schedule: "/admin/schedule",
    quotes: "/admin/quotes",
    proposals: "/admin/templates",
    invoices: "/admin/invoices",
    agreements: "/admin/agreements",
    inventory: "/admin/inventory",
    flatrate: "/admin/flat-rate",
    reports: "/admin/reports",
    analytics: "/admin/analytics",
    notifications: "/admin/notifications",
    audit: "/admin/audit",
    import: "/admin/import",
    settings: "/admin/settings",
  };

  return (
    <ErrorBoundary>
      <AdminHome
        onNavigate={(tab) => navigate(tabToRoute[tab] || "/admin")}
        onCreateLead={() => setShowCreateLead(true)}
      />
      <CreateLeadDialog open={showCreateLead} onOpenChange={setShowCreateLead} />
    </ErrorBoundary>
  );
};

export default AdminHomePage;
