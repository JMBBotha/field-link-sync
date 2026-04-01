import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Returns the current authenticated user's company_id from profiles.
 * Used to scope all tenant-owned inserts.
 */
export const useUserCompanyId = () => {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || cancelled) { setLoading(false); return; }
      const { data } = await supabase
        .from("profiles")
        .select("company_id")
        .eq("id", session.user.id)
        .single();
      if (!cancelled) {
        setCompanyId(data?.company_id ?? null);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { companyId, loading };
};
