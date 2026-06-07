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
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();

        if (sessionError) throw sessionError;
        if (!session || cancelled) {
          setLoading(false);
          return;
        }

        const { data, error } = await supabase
          .from("profiles")
          .select("company_id")
          .eq("id", session.user.id)
          .single();

        if (!cancelled) {
          if (error) {
            console.error("Failed to fetch company_id:", error);
            setCompanyId(null);
          } else {
            setCompanyId(data?.company_id ?? null);
          }
          setLoading(false);
        }
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
  }, []);

  return { companyId, loading };
};
