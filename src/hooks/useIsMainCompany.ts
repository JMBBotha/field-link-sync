import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * True when the signed-in user belongs to the main (master) company.
 * Pricing settings, terms and templates are authored only by the main company;
 * every other company inherits them (enforced in the database, 2026-10-13).
 */
export function useIsMainCompany() {
  const q = useQuery({
    queryKey: ["is-main-company"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return false;
      const { data } = await (supabase.rpc as any)("is_master_company_user", { _uid: u.user.id });
      return data === true;
    },
  });
  return { isMain: q.data === true, isLoading: q.isLoading };
}

export const INHERITED_NOTE = "Set by the main company (Massair) for every company in the network. Read-only here.";
