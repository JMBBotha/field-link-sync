import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/** Company-owner gate (e.g. /admin/money). Server-side check via is_my_company_owner(). */
export default function RequireOwner({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { data: isOwner, isLoading } = useQuery({
    queryKey: ["is-my-company-owner", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("is_my_company_owner");
      if (error) throw error;
      return data === true;
    },
    staleTime: 5 * 60_000,
  });
  if (!user?.id || isLoading) return null;
  if (!isOwner) return <Navigate to="/admin" replace />;
  return <>{children}</>;
}
