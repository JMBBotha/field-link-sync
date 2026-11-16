import { useState, useEffect } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import InvoiceListPage from "@/components/invoicing/InvoiceListPage";
import CreateInvoicePage from "@/components/invoicing/CreateInvoicePage";
import InvoiceDetailPage from "@/components/invoicing/InvoiceDetailPage";

type InvoiceView = "list" | "create" | "detail";

const AdminInvoicesPage = () => {
  const { session } = useAuth();
  const currentUserId = session?.user.id ?? "";
  const { id: routeInvoiceId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [view, setView] = useState<InvoiceView>(routeInvoiceId ? "detail" : "list");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(routeInvoiceId ?? null);
  const location = useLocation();
  const prefillLead = (location.state as any)?.prefillLead || null;

  useEffect(() => {
    if (routeInvoiceId) {
      setSelectedInvoiceId(routeInvoiceId);
      setView("detail");
    } else if (view === "detail") {
      setSelectedInvoiceId(null);
      setView("list");
    }
  }, [routeInvoiceId]);


  useEffect(() => {
    if (prefillLead) setView("create");
  }, [prefillLead]);

  return (
    <div className="h-full">
      {view === "list" && (
        <InvoiceListPage
          // Scope is enforced by RLS (rep_can_see_invoice / tech_lockdown_select).
          agentId={undefined}
          // Open as a real route so the shared header back arrow returns to this list (with its chips).
          onSelectInvoice={(inv) => navigate(`/admin/invoices/${inv.id}`)}
          onCreateInvoice={() => setView("create")}
        />
      )}
      {view === "create" && (
        <CreateInvoicePage
          agentId={currentUserId}
          onBack={() => { setView("list"); window.history.replaceState({}, ""); }}
          onSuccess={() => { setView("list"); window.history.replaceState({}, ""); }}
          prefillLead={prefillLead}
        />
      )}
      {view === "detail" && selectedInvoiceId && (
        <InvoiceDetailPage
          invoiceId={selectedInvoiceId}
          onBack={() => {
            if (routeInvoiceId) navigate("/admin/invoices");
            else setView("list");
          }}
          onUpdate={() => {}}
        />
      )}
    </div>
  );
};

export default AdminInvoicesPage;
