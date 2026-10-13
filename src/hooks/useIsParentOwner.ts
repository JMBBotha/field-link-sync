import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/** True only for the Massair owner (top-level Mandy). The server re-checks on every call. */
export function useIsParentOwner(): boolean {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["is-parent-owner", user?.id],
    enabled: !!user?.id,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("is_parent_owner", { _uid: user!.id });
      return !error && data === true;
    },
  });
  return data === true;
}
