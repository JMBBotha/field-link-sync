import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * True when the signed-in user belongs to the main (master) company.
 * Pricing settings, terms and templates are authored only by the main company;
 * every other company inherits them (enforced in the database, 2026-10-13).
 */
export function useIsMainCompany() {
  const { user, loading } = useAuth();
  const q = useQuery({
    queryKey: ["is-main-company", user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await (supabase.rpc as any)("is_master_company_user", { _uid: user!.id });
      return data === true;
    },
  });
  return { isMain: q.data === true, isLoading: loading || q.isLoading || (!!user?.id && q.isPending) };
}

export const INHERITED_NOTE = "Set by the main company (Massair) for every company in the network. Read-only here.";
