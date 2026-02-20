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

const isUUID = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export const CompanyProvider = ({ children }: { children: ReactNode }) => {
  const { companyId: paramId } = useParams<{ companyId: string }>();
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCompany = async () => {
    if (!paramId) { setLoading(false); return; }
    setLoading(true);
    console.log('Resolved companyId param:', paramId);

    // Try lookup by UUID or slug
    const col = isUUID(paramId) ? "id" : "slug";
    const { data } = await supabase
      .from("companies")
      .select("*")
      .eq(col, paramId)
      .maybeSingle();

    if (data) {
      console.log('Company found:', data.id, data.name);
      setCompany(data);
    } else {
      // Auto-create a test company
      console.log('No company found, auto-creating test company for:', paramId);
      const insertPayload: any = { name: "Test Company" };
      if (isUUID(paramId)) {
        insertPayload.id = paramId;
      } else {
        insertPayload.slug = paramId;
      }
      const { data: newCompany, error } = await supabase
        .from("companies")
        .insert(insertPayload)
        .select()
        .single();
      if (error) console.error('Auto-create company error:', error);
      if (newCompany) {
        console.log('Auto-created company:', newCompany.id);
        setCompany(newCompany);
      }
    }
    setLoading(false);
  };

  useEffect(() => { fetchCompany(); }, [paramId]);

  const resolvedId = company?.id || (paramId && isUUID(paramId) ? paramId : null);

  return (
    <CompanyContext.Provider value={{ company, companyId: resolvedId, loading, refetch: fetchCompany }}>
      {children}
    </CompanyContext.Provider>
  );
};
