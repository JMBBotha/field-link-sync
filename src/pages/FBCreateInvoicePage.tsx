import { useNavigate } from "react-router-dom";
import { useCompany } from "@/providers/CompanyProvider";
import { useAuth } from "@/contexts/AuthContext";
import CreateInvoicePage from "@/components/invoicing/CreateInvoicePage";
import { ArchivedHistoryNote } from "@/components/company/CompanyHistorySimple";
import { Loader2 } from "lucide-react";

/**
 * Wrapper page that renders the full CreateInvoicePage editor
 * inside the FreshBooks client portal at /client/:companyId/invoices/new
 */
const FBCreateInvoicePage = () => {
  const { company } = useCompany();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  if (company?.status === "archived") {
    return <ArchivedHistoryNote title="New invoice" body="This company is history only. Imported invoices stay on the invoice list. Nothing new can be created, edited, or sent." />;
  }
  const agentId = authLoading ? null : (user?.id || "00000000-0000-0000-0000-000000000001");

  if (!agentId) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <CreateInvoicePage
      agentId={agentId}
      onBack={() => navigate("../invoices")}
      onSuccess={() => navigate("../invoices")}
    />
  );
};

export default FBCreateInvoicePage;
