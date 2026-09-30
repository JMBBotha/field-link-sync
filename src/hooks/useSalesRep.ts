import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/useRole";
import { isSalesRep } from "@/lib/roleAccess";

export function useSalesRep(): { isSalesRep: boolean; loading: boolean } {
  const { roles, userId, loading: roleLoading } = useRole();
  const q = useQuery({
    queryKey: ["my-dispatch-role", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("dispatch_role").eq("id", userId!).maybeSingle();
      if (error) throw error;
      return (data as { dispatch_role: string | null } | null)?.dispatch_role ?? null;
    },
  });
  return {
    isSalesRep: isSalesRep(roles as string[], q.data),
    loading: roleLoading || (!!userId && q.isLoading),
  };
}
