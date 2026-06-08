import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import Layout from "@/components/Layout";
import InvoiceListPage from "@/components/invoicing/InvoiceListPage";
import CreateInvoicePage from "@/components/invoicing/CreateInvoicePage";
import InvoiceDetailPage from "@/components/invoicing/InvoiceDetailPage";
import logo from "@/assets/logo.png";

type InvoiceView = "list" | "create" | "detail";

const Invoices = () => {
  const { session, loading: authLoading } = useAuth();
  const currentUserId = session?.user.id ?? "";
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [view, setView] = useState<InvoiceView>("list");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  // Check for prefill lead from navigation state
  const prefillLead = (location.state as any)?.prefillLead || null;

  useEffect(() => {
    if (authLoading) return;
    if (!session) {
      navigate("/auth");
      return;
    }
    (async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.user.id);

      setIsAdmin(roles?.some(r => r.role === "admin") || false);
      setLoading(false);
    })();
  }, [session, authLoading, navigate]);

  // If navigated with prefill data, go straight to create view
  useEffect(() => {
    if (prefillLead && !loading) {
      setView("create");
    }
  }, [prefillLead, loading]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <Layout>
      <div className="flex flex-col h-screen">
        {/* Header */}
        <header className="border-b px-4 py-3 flex items-center justify-between shrink-0" style={{ backgroundColor: '#0077B6', borderColor: '#006699' }}>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="text-white hover:bg-blue-500 h-9 w-9" onClick={() => navigate(isAdmin ? "/admin" : "/field")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <img src={logo} alt="Logo" className="h-10" />
            <h1 className="text-lg font-bold text-white">Invoices</h1>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto bg-background">
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
              onBack={() => {
                setView("list");
                // Clear navigation state so prefill doesn't persist
                window.history.replaceState({}, "");
              }}
              onSuccess={() => {
                setView("list");
                window.history.replaceState({}, "");
              }}
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
      </div>
    </Layout>
  );
};

export default Invoices;
