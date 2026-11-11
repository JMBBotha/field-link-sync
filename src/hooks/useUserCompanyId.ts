import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Returns the current authenticated user's company_id from profiles.
 * Used to scope all tenant-owned inserts.
 * The lookup follows the user id, not the session object. A token refresh
 * replaces that object and must not cancel a read that already succeeded,
 * or wipe a company we already resolved for this same person.
 */
export const useUserCompanyId = () => {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const resolvedFor = useRef<string | null>(null);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;

    if (authLoading) return;
    if (!userId) {
      resolvedFor.current = null;
      setCompanyId(null);
      setError(null);
      setLoading(false);
      return;
    }
    if (resolvedFor.current && resolvedFor.current !== userId) {
      resolvedFor.current = null;
      setCompanyId(null);
    }

    setLoading(true);
    (async () => {
      try {
        const { data, error: queryError } = await supabase
          .from("profiles")
          .select("company_id")
          .eq("id", userId)
          .single();

        if (cancelled) return;
        if (queryError) {
          console.error("Failed to fetch company_id:", queryError);
          setError(queryError.message || "Couldn't load your company");
          if (resolvedFor.current !== userId) setCompanyId(null);
        } else {
          resolvedFor.current = userId;
          setError(null);
          setCompanyId(data?.company_id ?? null);
        }
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          console.error("useUserCompanyId error:", err);
          setError(err instanceof Error ? err.message : "Couldn't load your company");
          if (resolvedFor.current !== userId) setCompanyId(null);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, authLoading, attempt]);

  return { companyId, loading, error, reload };
};
