import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/** The admin account this login is linked to (rep_linked_admin), or null. */
export function useLinkedAdmin() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-linked-admin", user?.id], enabled: !!user?.id, staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("my_linked_admin");
      if (error) return null;
      return (data as string | null) ?? null;
    },
  });
}
