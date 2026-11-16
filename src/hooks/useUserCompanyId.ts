import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * The signed-in person's company_id.
 * Cached on the shared query client, keyed by user id. A token refresh
 * replaces the session object and must not cancel a read that already
 * succeeded, or make every page look like it is loading again.
 */
export const useUserCompanyId = () => {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;

  const query = useQuery({
    queryKey: ["profile-company-id", userId],
    enabled: !authLoading && !!userId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("company_id")
        .eq("id", userId as string)
        .single();
      if (error) throw error;
      return (data?.company_id ?? null) as string | null;
    },
  });

  const companyId = query.data === undefined ? null : query.data;
  const failed = query.isError && query.data === undefined;

  return {
    companyId,
    loading: authLoading || (!!userId && query.isPending),
    error: failed ? (query.error instanceof Error ? query.error.message : "Couldn't load your company") : null,
    reload: () => { void query.refetch(); },
  };
};
