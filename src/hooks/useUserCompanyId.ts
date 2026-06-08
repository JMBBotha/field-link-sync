import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Returns the current authenticated user's company_id from profiles.
 * Used to scope all tenant-owned inserts.
 */
export const useUserCompanyId = () => {
  const { user, loading: authLoading } = useAuth();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    if (authLoading) return;
    if (!user) {
      setCompanyId(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    (async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("company_id")
          .eq("id", user.id)
          .single();

        if (cancelled) return;
        if (error) {
          console.error("Failed to fetch company_id:", error);
          setCompanyId(null);
        } else {
          setCompanyId(data?.company_id ?? null);
        }
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          console.error("useUserCompanyId error:", err);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  return { companyId, loading };
};
