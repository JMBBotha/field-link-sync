import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

interface Company {
  id: string;
  name: string;
  logo_url: string | null;
  address: any;
  phone: string | null;
  email: string | null;
}

interface CompanyContextValue {
  company: Company | null;
  companyId: string | null;
  loading: boolean;
  refetch: () => void;
}

const CompanyContext = createContext<CompanyContextValue>({
  company: null,
  companyId: null,
  loading: true,
  refetch: () => {},
});

export const useCompany = () => useContext(CompanyContext);

export const CompanyProvider = ({ children }: { children: ReactNode }) => {
  const { companyId } = useParams<{ companyId: string }>();
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCompany = async () => {
    if (!companyId) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from("companies")
      .select("*")
      .eq("id", companyId)
      .maybeSingle();
    setCompany(data);
    setLoading(false);
  };

  useEffect(() => {
    console.log('Resolved companyId:', companyId);
    fetchCompany();
  }, [companyId]);

  return (
    <CompanyContext.Provider value={{ company, companyId: companyId || null, loading, refetch: fetchCompany }}>
      {children}
    </CompanyContext.Provider>
  );
};
