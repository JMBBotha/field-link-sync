import { useSalesRep } from "@/hooks/useSalesRep";
import { useLinkedAdmin } from "@/hooks/useLinkedAdmin";
import { ownScopeOnly } from "@/lib/homeScope";

/** ownOnly = plain sales rep (not linked to an admin). loading while either lookup is pending. */
export function useOwnScope() {
  const { isSalesRep, loading } = useSalesRep();
  const la = useLinkedAdmin();
  return { ownOnly: ownScopeOnly(isSalesRep, la.data), loading: loading || (isSalesRep && la.isLoading), isSalesRep };
}
