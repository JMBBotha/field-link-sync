import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/** True when the signed-in user is an admin of the master company (may change the shared catalogue). */
export function useCanWriteMasterCatalog() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["can-write-master-catalog", user?.id],
    enabled: !!user?.id,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("can_write_master_catalog", { _uid: user!.id });
      if (error) throw error;
      return !!data;
    },
  });
  return { canWrite: !!data, isLoading };
}

export const MASTER_ONLY_NOTE = "Price lists are managed by the main company";

/** Hides price-list upload / activate / archive tools for anyone who can't write the master catalogue. */
export default function MasterCatalogGate({ children }: { children: ReactNode }) {
  const { canWrite, isLoading } = useCanWriteMasterCatalog();
  if (isLoading) return null;
  if (!canWrite) return <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">{MASTER_ONLY_NOTE}</p>;
  return <>{children}</>;
}
