import { useQuery } from "@tanstack/react-query";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { loadCompanyClients, type DirectoryClient } from "@/lib/clientSearch";

/**
 * All clients for the signed-in company. Shared by the Clients list and the
 * quote, invoice, global, and Book a job searches so they cannot drift apart.
 */
export function useCompanyClients(archived = false, enabled = true) {
  const { companyId, loading: companyLoading } = useUserCompanyId();
  const query = useQuery<DirectoryClient[]>({
    queryKey: ["all-customers-fb", companyId ?? "profile", archived ? "archived" : "active"],
    enabled: enabled && !companyLoading,
    staleTime: 30_000,
    queryFn: () => loadCompanyClients(companyId, { archived }),
  });
  return {
    ...query,
    clients: query.data ?? [],
    isLoading: enabled && (companyLoading || query.isLoading || (query.isFetching && !query.data)),
  };
}
