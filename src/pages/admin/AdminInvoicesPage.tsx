import { useState, useEffect } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import InvoiceListPage from "@/components/invoicing/InvoiceListPage";
import CreateInvoicePage from "@/components/invoicing/CreateInvoicePage";
import InvoiceDetailPage from "@/components/invoicing/InvoiceDetailPage";

type InvoiceView = "list" | "create" | "detail";

const AdminInvoicesPage = () => {
  const { session, loading: authLoading } = useAuth();
  const currentUserId = session?.user.id ?? "";
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
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
    if (authLoading) return;
    if (!session) return;
    (async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.user.id);
      setIsAdmin(roles?.some(r => r.role === "admin") || false);
      setLoading(false);
    })();
  }, [session, authLoading]);

  useEffect(() => {
    if (prefillLead && !loading) setView("create");
  }, [prefillLead, loading]);

  if (loading) return <div className="flex items-center justify-center py-12"><span>Loading...</span></div>;

  return (
    <div className="h-full">
      {view === "list" && (
        <InvoiceListPage
          agentId={isAdmin ? undefined : currentUserId}
          onSelectInvoice={(inv) => {
            setSelectedInvoiceId(inv.id);
            setView("detail");
          }}
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
