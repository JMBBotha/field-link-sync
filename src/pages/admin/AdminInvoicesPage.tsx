import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import InvoiceListPage from "@/components/invoicing/InvoiceListPage";
import CreateInvoicePage from "@/components/invoicing/CreateInvoicePage";
import InvoiceDetailPage from "@/components/invoicing/InvoiceDetailPage";

type InvoiceView = "list" | "create" | "detail";

const AdminInvoicesPage = () => {
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<InvoiceView>("list");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const location = useLocation();
  const prefillLead = (location.state as any)?.prefillLead || null;

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setCurrentUserId(session.user.id);
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.user.id);
      setIsAdmin(roles?.some(r => r.role === "admin") || false);
      setLoading(false);
    })();
  }, []);

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
          onBack={() => setView("list")}
          onUpdate={() => {}}
        />
      )}
    </div>
  );
};

export default AdminInvoicesPage;
