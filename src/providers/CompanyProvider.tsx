import { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo, ReactNode } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { TablesInsert } from "@/integrations/supabase/types";

interface Company {
  id: string;
  name: string;
  slug: string | null;
  logo_url: string | null;
  vat_rate: number | null;
  default_rate: number | null;
  services: string[] | null;
  onboarding_completed: boolean | null;
}

interface CompanyContextValue {
  company: Company | null;
  companyId: string | null;
  loading: boolean;
  refetch: () => Promise<void>;
}

const CompanyContext = createContext<CompanyContextValue>({
  company: null,
  companyId: null,
  loading: true,
  refetch: async () => {},
});

export const useCompany = () => useContext(CompanyContext);

const isUUID = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export const CompanyProvider = ({ children }: { children: ReactNode }) => {
  const { companyId: paramId } = useParams<{ companyId: string }>();
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);
  const fetchSeqRef = useRef(0);

  const fetchCompany = useCallback(async () => {
    const seq = ++fetchSeqRef.current;

    if (!paramId) {
      if (mountedRef.current && seq === fetchSeqRef.current) {
        setCompany(null);
        setLoading(false);
      }
      return;
    }

    if (mountedRef.current && seq === fetchSeqRef.current) setLoading(true);
    console.log("Resolved companyId param:", paramId);

    try {
      const col = isUUID(paramId) ? "id" : "slug";
      const { data, error } = await supabase
        .from("companies")
        .select("*")
        .eq(col, paramId)
        .maybeSingle();

      if (!mountedRef.current || seq !== fetchSeqRef.current) return;
      if (error) {
        console.error("Company lookup error:", error);
        setLoading(false);
        return;
      }

      if (data) {
        console.log("Company found:", data.id, data.name);
        setCompany(data as Company);
      } else {
        console.log("No company found, auto-creating test company for:", paramId);
        const insertPayload: TablesInsert<"companies"> = isUUID(paramId)
          ? { name: "Test Company", id: paramId }
          : { name: "Test Company", slug: paramId };

        const { data: newCompany, error: insertError } = await supabase
          .from("companies")
          .insert(insertPayload)
          .select()
          .single();

        if (!mountedRef.current || seq !== fetchSeqRef.current) return;
        if (insertError) {
          console.error("Auto-create company error:", insertError);
        } else if (newCompany) {
          console.log("Auto-created company:", newCompany.id);
          setCompany(newCompany as Company);
        }
      }
    } catch (e: unknown) {
      console.error("CompanyProvider fetch error:", e);
    } finally {
      if (mountedRef.current && seq === fetchSeqRef.current) setLoading(false);
    }
  }, [paramId]);

  useEffect(() => {
    mountedRef.current = true;
    void fetchCompany();
    return () => { mountedRef.current = false; };
  }, [fetchCompany]);

  const resolvedId = company?.id || (paramId && isUUID(paramId) ? paramId : null);

  const value = useMemo<CompanyContextValue>(
    () => ({ company, companyId: resolvedId, loading, refetch: fetchCompany }),
    [company, resolvedId, loading, fetchCompany]
  );

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
};
