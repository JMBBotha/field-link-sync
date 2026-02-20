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
    console.log('Resolved companyId:', companyId);
    const { data } = await supabase
      .from("companies")
      .select("*")
      .eq("id", companyId)
      .maybeSingle();
    if (data) {
      setCompany(data);
    } else {
      // Auto-create a test company with this ID
      console.log('No company found, auto-creating test company for id:', companyId);
      const { data: newCompany } = await supabase
        .from("companies")
        .insert({ id: companyId, name: "Test Company" })
        .select()
        .single();
      if (newCompany) setCompany(newCompany);
    }
    setLoading(false);
  };

  useEffect(() => { fetchCompany(); }, [companyId]);

  return (
    <CompanyContext.Provider value={{ company, companyId: companyId || null, loading, refetch: fetchCompany }}>
      {children}
    </CompanyContext.Provider>
  );
};
