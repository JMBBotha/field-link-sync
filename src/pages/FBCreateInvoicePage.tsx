import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCompany } from "@/providers/CompanyProvider";
import { supabase } from "@/integrations/supabase/client";
import CreateInvoicePage from "@/components/invoicing/CreateInvoicePage";
import { Loader2 } from "lucide-react";

/**
 * Wrapper page that renders the full CreateInvoicePage editor
 * inside the FreshBooks client portal at /client/:companyId/invoices/new
 */
const FBCreateInvoicePage = () => {
  const { companyId } = useCompany();
  const navigate = useNavigate();
  const [agentId, setAgentId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAgentId(data?.session?.user?.id || "00000000-0000-0000-0000-000000000001");
    });
  }, []);

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
