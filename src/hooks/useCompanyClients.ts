import { useQuery } from "@tanstack/react-query";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { loadCompanyClients, type DirectoryClient } from "@/lib/clientSearch";
import { refreshOnVisit } from "@/lib/queryDefaults";

/**
 * All clients for the signed-in company. Shared by the Clients list and the
 * quote, invoice, global, and Book a job searches so they cannot drift apart.
 */
export function useCompanyClients(archived = false, enabled = true) {
  const { companyId, loading: companyLoading } = useUserCompanyId();
  const query = useQuery<DirectoryClient[]>({
    queryKey: ["all-customers-fb", companyId ?? "profile", archived ? "archived" : "active"],
    enabled: enabled && !companyLoading,
    ...refreshOnVisit,
    queryFn: () => loadCompanyClients(companyId, { archived }),
  });
  return {
    ...query,
    clients: query.data ?? [],
    // A return visit already has rows: keep them up while company id or a refetch is in flight.
    isLoading: enabled && query.data === undefined && (companyLoading || query.isPending || query.isFetching),
  };
}
